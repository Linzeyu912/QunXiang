import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { BookArtifactRepository, BookRepository, getSharedAssetSourceResolver, persistBookArtifact } from '@novel-agent/storage';
import { parseTxtEnhanced } from '@novel-agent/import';
import {
  buildStorySegmentsFromParseResult,
  buildStoryAssetBundle,
  buildStoryAssetPromptPack,
  qualityFor,
  runDirectorPipelineForStory,
  storyAssetDirectory,
  writeStoryAssetFiles,
} from '@novel-agent/story-arcs';
import type {
  AssetWarning,
  CharacterInStory,
  DirectorAssignment,
  DirectorPipelineResult,
  PropInStory,
  SceneInStory,
  ScriptEpisode,
  ScriptEpisodePlan,
  ScriptReview,
  StoryAssetBundle,
  StoryAssetPack,
  StoryAssetPromptPack,
  StoryboardPromptPack,
  StoryCharacterFile,
  StoryPropFile,
  StorySceneFile,
  StorySegment,
  VideoPromptPack,
} from '@novel-agent/story-arcs';
import { readArtifactJson } from './artifact-store.js';

// 输出目录统一用 bookId 作为目录名（与 director-pipeline 内部的
// storyAssetDirectory(outputDir, bundle.story.bookId, …) 保持一致），
// 避免 bookId ↔ 可读 slug 的映射问题。
const OUTPUT_ROOT = 'output';

// ---------- 文件布局 ----------

function bookDir(bookId: string): string {
  return join(OUTPUT_ROOT, bookId);
}

function segmentsFile(bookId: string): string {
  return join(bookDir(bookId), 'story-segments.json');
}

function reviewFile(bookId: string): string {
  return join(bookDir(bookId), 'story-boundary-review.json');
}

function assignmentsFile(bookId: string): string {
  return join(bookDir(bookId), 'director-assignments.json');
}

function storyDir(bookId: string, storyId: string): string {
  return storyAssetDirectory(OUTPUT_ROOT, bookId, storyId);
}

/** 故事产物本机写 + 对象存储 / BookArtifact 双写（category: 'story'）。 */
async function writeStoryArtifact(
  bookId: string,
  logicalPath: string,
  fsPath: string,
  value: unknown,
): Promise<void> {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  await mkdir(dirname(fsPath), { recursive: true });
  await writeFile(fsPath, body, 'utf-8');
  await persistBookArtifact({ bookId, logicalPath, category: 'story', body });
}

/** writeStoryAssetFiles 后把 9 个故事资产文件同步到对象存储（in-memory，避免回读磁盘）。 */
async function persistStoryAssetArtifacts(
  bookId: string,
  files: {
    story?: StorySegment;
    characters: StoryCharacterFile;
    scenes: StorySceneFile;
    props: StoryPropFile;
    assetPack: StoryAssetPack;
    assetPrompts: StoryAssetPromptPack;
  },
): Promise<void> {
  const storyId = files.assetPack.storyId;
  const base = `stories/${storyId}`;
  const writes: Array<{ filename: string; value: unknown }> = [
    { filename: 'characters.json', value: files.characters },
    { filename: 'scenes.json', value: files.scenes },
    { filename: 'props.json', value: files.props },
    { filename: 'asset-pack.json', value: files.assetPack },
    { filename: 'character-prompts.json', value: { storyId, bookId, prompts: files.assetPrompts.characterPrompts } },
    { filename: 'scene-prompts.json', value: { storyId, bookId, prompts: files.assetPrompts.scenePrompts } },
    { filename: 'prop-prompts.json', value: { storyId, bookId, prompts: files.assetPrompts.propPrompts } },
    { filename: 'asset-prompts.json', value: files.assetPrompts },
  ];
  if (files.story) writes.push({ filename: 'story.json', value: files.story });
  await Promise.all(
    writes.map((w) =>
      persistBookArtifact({
        bookId,
        logicalPath: `${base}/${w.filename}`,
        category: 'story',
        body: `${JSON.stringify(w.value, null, 2)}\n`,
      }),
    ),
  );
}

/** runDirectorPipelineForStory 后把 6 个导演文件同步到对象存储（in-memory）。 */
async function persistDirectorArtifacts(
  bookId: string,
  storyId: string,
  result: DirectorPipelineResult,
): Promise<void> {
  const base = `stories/${storyId}/director`;
  const writes: Array<{ filename: string; value: unknown }> = [
    { filename: 'director-assignment.json', value: result.assignment },
    { filename: 'episode-plan.json', value: { storyId, plans: result.episodePlans } },
    { filename: 'script-episodes.json', value: { storyId, episodes: result.scriptEpisodes } },
    { filename: 'script-review.json', value: result.scriptReview },
    { filename: 'storyboard-prompt-pack.json', value: result.storyboardPromptPacks[0] },
    { filename: 'video-prompt-pack.json', value: result.videoPromptPacks[0] },
  ];
  await Promise.all(
    writes.map((w) =>
      persistBookArtifact({
        bookId,
        logicalPath: `${base}/${w.filename}`,
        category: 'director',
        body: `${JSON.stringify(w.value, null, 2)}\n`,
      }),
    ),
  );
}

// ---------- 持久化文档结构 ----------

interface SegmentsDoc {
  bookId: string;
  generatedAt: string;
  segments: StorySegment[];
}

export type BoundaryDecision = 'confirm' | 'merge_with_previous';

/**
 * v1 边界审核项：后端尚无 LLM BoundaryJudge，审核项由确定性切分结果里
 * boundaryConfidence < 0.82 的段派生。裁决动作：确认边界 / 并入上一段。
 */
export interface BoundaryReviewApiItem {
  id: string;
  bookId: string;
  segmentId: string;
  betweenChapter: [number, number];
  suggestedDecision: BoundaryDecision;
  confidence: number;
  reason: string;
  leftSummary: string;
  rightSummary: string;
  evidence: {
    sharedCharacters: string[];
    leftCharacters: string[];
    rightCharacters: string[];
    arcType?: string;
    turningPoints: string[];
  };
  canMerge: boolean;
  status: 'pending' | 'resolved';
  resolvedDecision?: BoundaryDecision;
}

interface ReviewDoc {
  bookId: string;
  items: BoundaryReviewApiItem[];
}

export interface AssignmentWithStatus extends DirectorAssignment {
  status: 'completed' | 'failed';
  error?: string;
}

interface AssignmentsDoc {
  bookId: string;
  assignments: AssignmentWithStatus[];
}

export type StorySummary = Omit<StorySegment, 'sourceText'> & {
  assetsExtracted: boolean;
  directorRan: boolean;
};

// ---------- 任务注册表 + 事件（仅切分是异步的） ----------

export interface StoryTask {
  id: string;
  bookId: string;
  kind: 'segment';
  status: 'running' | 'completed' | 'failed';
  stage?: string;
  message?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

const tasks = new Map<string, StoryTask>();
const storyEvents = new EventEmitter();
storyEvents.setMaxListeners(100);

export interface StoryPipelineEvent {
  type: 'stage-started' | 'stage-completed' | 'review-needed' | 'done' | 'error';
  taskId: string;
  stage?: string;
  message?: string;
  pendingCount?: number;
  timestamp: number;
}

function channel(bookId: string): string {
  return `story:${bookId}`;
}

function emit(bookId: string, event: StoryPipelineEvent): void {
  storyEvents.emit(channel(bookId), event);
}

function touchTask(task: StoryTask, patch: Partial<StoryTask>): void {
  Object.assign(task, patch, { updatedAt: new Date().toISOString() });
}

// ---------- 错误类型 ----------

export class NotFoundError extends Error {}
export class ConflictError extends Error {}
export class BadRequestError extends Error {}

// ---------- 边界审核派生 ----------

const CONFIDENT_BOUNDARY = 0.82;
const MERGE_HINT = 0.72;

function deriveBoundaryReviews(bookId: string, segments: StorySegment[]): BoundaryReviewApiItem[] {
  const sorted = [...segments].sort(
    (a, b) => a.startChapter - b.startChapter || a.id.localeCompare(b.id),
  );
  const items: BoundaryReviewApiItem[] = [];

  sorted.forEach((seg, idx) => {
    if (seg.boundaryConfidence >= CONFIDENT_BOUNDARY) return;
    const prev = idx > 0 ? sorted[idx - 1] : undefined;
    const shared = prev
      ? seg.mainCharacters.filter((n) => prev.mainCharacters.includes(n))
      : [];
    const canMerge = !!prev;
    const suggestMerge = canMerge && shared.length > 0 && seg.boundaryConfidence < MERGE_HINT;

    items.push({
      id: `review-${seg.id}`,
      bookId,
      segmentId: seg.id,
      betweenChapter: prev ? [prev.endChapter, seg.startChapter] : [seg.startChapter, seg.endChapter],
      suggestedDecision: suggestMerge ? 'merge_with_previous' : 'confirm',
      confidence: seg.boundaryConfidence,
      reason: suggestMerge
        ? `该段边界置信度 ${seg.boundaryConfidence.toFixed(2)} 偏低，且与上一段共享主角（${shared.join('、')}），可能属于同一故事。`
        : `该段边界置信度 ${seg.boundaryConfidence.toFixed(2)} 低于阈值 ${CONFIDENT_BOUNDARY}，需要人工确认切分是否合理。`,
      leftSummary: prev ? prev.summary : '（书首，无上一段）',
      rightSummary: seg.summary,
      evidence: {
        sharedCharacters: shared,
        leftCharacters: prev ? prev.mainCharacters : [],
        rightCharacters: seg.mainCharacters,
        arcType: seg.arcType,
        turningPoints: seg.turningPoints.slice(0, 6),
      },
      canMerge,
      status: 'pending',
      resolvedDecision: undefined,
    });
  });

  return items;
}

// ---------- 切分（异步 + SSE） ----------

export interface SegmentationOptions {
  maxChaptersPerSegment?: number;
  autoApprove?: boolean;
}

async function requireOwnedBook(bookId: string, ownerId: string) {
  const book = await BookRepository.findOwnedById(bookId, ownerId);
  if (!book) throw new NotFoundError('书籍不存在或无权访问');
  return book;
}

/** 任何按 storyId 访问文件的入口，都必须先确认故事段属于该账号的这本书。 */
async function requireOwnedStory(bookId: string, ownerId: string, storyId: string): Promise<StorySegment> {
  await requireOwnedBook(bookId, ownerId);
  const doc = await loadSegmentsDoc(bookId);
  const story = doc?.segments.find((segment) => segment.id === storyId);
  if (!story) throw new NotFoundError('故事段不存在');
  return story;
}

export async function startSegmentation(
  bookId: string,
  ownerId: string,
  options: SegmentationOptions = {},
): Promise<{ taskId: string; existing: boolean }> {
  const book = await requireOwnedBook(bookId, ownerId);
  for (const task of tasks.values()) {
    if (task.bookId === bookId && task.status === 'running') {
      return { taskId: task.id, existing: true };
    }
  }

  const task: StoryTask = {
    id: `story-seg-${randomUUID().slice(0, 8)}`,
    bookId,
    kind: 'segment',
    status: 'running',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  tasks.set(task.id, task);

  const sourceContent = await getSharedAssetSourceResolver().readSourceText(book);
  void runSegmentation(task, sourceContent, book.title, options).catch((err) => {
    touchTask(task, { status: 'failed', error: String(err) });
    emit(bookId, { type: 'error', taskId: task.id, message: String(err), timestamp: Date.now() });
  });

  return { taskId: task.id, existing: false };
}

async function runSegmentation(
  task: StoryTask,
  content: string,
  title: string,
  options: SegmentationOptions = {},
): Promise<void> {
  const { bookId } = task;
  const stage = (name: string, message?: string) => {
    touchTask(task, { stage: name, message });
    emit(bookId, { type: 'stage-started', taskId: task.id, stage: name, message, timestamp: Date.now() });
  };
  const stageDone = (name: string, message?: string) => {
    emit(bookId, { type: 'stage-completed', taskId: task.id, stage: name, message, timestamp: Date.now() });
  };

  stage('chapter-analysis', '解析章节与实体预扫描');
  const enhanced = await parseTxtEnhanced(content, title, {
    bookId,
    prescanOutputPath: join('.intermediate', 'story', bookId, 'prescan'),
    useLLM: false,
  });
  stageDone('chapter-analysis', `共 ${enhanced.chapters.length} 章`);

  stage('segment-assembly', '组装故事段');
  const segments = buildStorySegmentsFromParseResult(enhanced, {
    bookId,
    prescanResult: enhanced.prescanResult,
    maxChaptersPerSegment: options.maxChaptersPerSegment,
    autoApprove: options.autoApprove ?? false,
  });
  const reviews = deriveBoundaryReviews(bookId, segments);

  // 重切分会使旧的资产/剧本失效，直接清空 stories 子树
  await rm(join(bookDir(bookId), 'stories'), { recursive: true, force: true });
  const doc: SegmentsDoc = { bookId, generatedAt: new Date().toISOString(), segments };
  await writeStoryArtifact(bookId, 'story-segments.json', segmentsFile(bookId), doc);
  await writeStoryArtifact(bookId, 'story-boundary-review.json', reviewFile(bookId), { bookId, items: reviews } satisfies ReviewDoc);
  stageDone('segment-assembly', `共 ${segments.length} 段`);

  const pending = reviews.filter((r) => r.status === 'pending').length;
  if (pending > 0) {
    emit(bookId, { type: 'review-needed', taskId: task.id, pendingCount: pending, timestamp: Date.now() });
  }

  touchTask(task, { status: 'completed', stage: undefined, message: `共 ${segments.length} 段` });
  emit(bookId, { type: 'done', taskId: task.id, timestamp: Date.now() });
}

export async function getSegmentationStatus(taskId: string, ownerId: string): Promise<StoryTask | null> {
  const task = tasks.get(taskId) ?? null;
  if (!task) return null;
  await requireOwnedBook(task.bookId, ownerId);
  return task;
}

/** SSE 流：转发本书的故事管线事件，terminal 事件后关闭。 */
export async function* createStoryStream(bookId: string, ownerId: string): AsyncGenerator<string> {
  await requireOwnedBook(bookId, ownerId);
  const running = [...tasks.values()].find((t) => t.bookId === bookId && t.status === 'running');
  yield `data: ${JSON.stringify({ type: 'snapshot', task: running ?? null, timestamp: Date.now() })}\n\n`;
  if (!running) return;

  const queue: StoryPipelineEvent[] = [];
  let wake: (() => void) | null = null;
  const listener = (event: StoryPipelineEvent) => {
    queue.push(event);
    wake?.();
    wake = null;
  };
  storyEvents.on(channel(bookId), listener);

  try {
    while (true) {
      if (queue.length === 0) {
        const result = await new Promise<'event' | 'heartbeat'>((resolve) => {
          wake = () => resolve('event');
          setTimeout(() => {
            if (wake) {
              wake = null;
              resolve('heartbeat');
            }
          }, 15000);
        });
        if (result === 'heartbeat') {
          yield ': heartbeat\n\n';
          continue;
        }
      }
      const event = queue.shift();
      if (!event) continue;
      yield `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
      if (event.type === 'done' || event.type === 'error') return;
    }
  } finally {
    storyEvents.off(channel(bookId), listener);
  }
}

// ---------- 故事段读写 ----------

/** 读 stories/{storyId}/{filename}：优先 BookArtifact，回退本机 output/。 */
async function readStoryFile<T>(bookId: string, storyId: string, filename: string): Promise<T | null> {
  return readArtifactJson<T>(
    bookId,
    `stories/${storyId}/${filename}`,
    join(storyDir(bookId, storyId), filename),
  );
}

/** 读 stories/{storyId}/director/{filename}：优先 BookArtifact，回退本机 output/。 */
async function readDirectorFile<T>(bookId: string, storyId: string, filename: string): Promise<T | null> {
  return readArtifactJson<T>(
    bookId,
    `stories/${storyId}/director/${filename}`,
    join(storyDir(bookId, storyId), 'director', filename),
  );
}

async function loadSegmentsDoc(bookId: string): Promise<SegmentsDoc | null> {
  return readArtifactJson<SegmentsDoc>(bookId, 'story-segments.json', segmentsFile(bookId));
}

async function loadReviewDoc(bookId: string): Promise<ReviewDoc> {
  return (await readArtifactJson<ReviewDoc>(bookId, 'story-boundary-review.json', reviewFile(bookId))) ?? { bookId, items: [] };
}

function stripSource(seg: StorySegment): Omit<StorySegment, 'sourceText'> {
  const { sourceText: _sourceText, ...rest } = seg;
  return rest;
}

function toSummary(bookId: string, seg: StorySegment, artifactPaths?: Set<string>): StorySummary {
  const hasArtifact = (logicalPath: string) =>
    Boolean(artifactPaths?.has(logicalPath)) ||
    existsSync(join(OUTPUT_ROOT, bookId, logicalPath));
  return {
    ...stripSource(seg),
    assetsExtracted: hasArtifact(`stories/${seg.id}/asset-pack.json`),
    directorRan: hasArtifact(`stories/${seg.id}/director/script-episodes.json`),
  };
}

export async function listStories(bookId: string, ownerId: string): Promise<{
  stories: StorySummary[];
  pendingBoundaryReviews: number;
  generatedAt: string | null;
}> {
  await requireOwnedBook(bookId, ownerId);
  const doc = await loadSegmentsDoc(bookId);
  const review = await loadReviewDoc(bookId);
  // 一次性拉取该书全部 BookArtifact logicalPath，供 toSummary 判定资产/导演是否已生成（多设备无本机 output/ 也能正确显示）。
  let artifactPaths: Set<string> | undefined;
  try {
    const artifacts = await BookArtifactRepository.findByBook(bookId);
    artifactPaths = new Set(artifacts.map((a) => a.logicalPath));
  } catch (err) {
    console.warn(`[story] 读取 BookArtifact 列表失败，回退本机 output/：${err instanceof Error ? err.message : err}`);
  }
  const sorted = [...(doc?.segments ?? [])].sort(
    (a, b) => a.startChapter - b.startChapter || a.id.localeCompare(b.id),
  );
  return {
    stories: sorted.map((s) => toSummary(bookId, s, artifactPaths)),
    pendingBoundaryReviews: review.items.filter((i) => i.status === 'pending').length,
    generatedAt: doc?.generatedAt ?? null,
  };
}

export async function getStory(
  bookId: string,
  ownerId: string,
  storyId: string,
  includeSource: boolean,
): Promise<StorySegment | Omit<StorySegment, 'sourceText'>> {
  await requireOwnedBook(bookId, ownerId);
  const doc = await loadSegmentsDoc(bookId);
  const seg = doc?.segments.find((s) => s.id === storyId);
  if (!seg) throw new NotFoundError(`故事段不存在：${storyId}`);
  return includeSource ? seg : stripSource(seg);
}

export async function approveStory(
  bookId: string,
  ownerId: string,
  storyId: string,
  approved: boolean,
): Promise<StorySummary> {
  await requireOwnedBook(bookId, ownerId);
  const doc = await loadSegmentsDoc(bookId);
  if (!doc) throw new NotFoundError('尚未生成故事段');
  const seg = doc.segments.find((s) => s.id === storyId);
  if (!seg) throw new NotFoundError(`故事段不存在：${storyId}`);

  if (approved) {
    const review = await loadReviewDoc(bookId);
    const pending = review.items.find((i) => i.segmentId === storyId && i.status === 'pending');
    if (pending) {
      throw new ConflictError('该故事段仍有待裁决的边界审核项，请先完成边界审核');
    }
  }

  seg.approved = approved;
  await writeStoryArtifact(bookId, 'story-segments.json', segmentsFile(bookId), doc);
  return toSummary(bookId, seg);
}

export async function approveStoriesBatch(
  bookId: string,
  ownerId: string,
  storyIds: string[],
  approved: boolean,
): Promise<{ updated: string[]; skipped: { storyId: string; reason: string }[] }> {
  const updated: string[] = [];
  const skipped: { storyId: string; reason: string }[] = [];
  for (const storyId of storyIds) {
    try {
      await approveStory(bookId, ownerId, storyId, approved);
      updated.push(storyId);
    } catch (err) {
      skipped.push({ storyId, reason: err instanceof Error ? err.message : String(err) });
    }
  }
  return { updated, skipped };
}

// ---------- 边界审核 ----------

export async function listBoundaryReviews(
  bookId: string,
  ownerId: string,
  status?: 'pending' | 'resolved',
): Promise<{ items: BoundaryReviewApiItem[] }> {
  await requireOwnedBook(bookId, ownerId);
  const doc = await loadReviewDoc(bookId);
  const items = status ? doc.items.filter((i) => i.status === status) : doc.items;
  return { items };
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}

function mergeSegments(prev: StorySegment, cur: StorySegment): StorySegment {
  const mainCharacters = uniqueStrings([...prev.mainCharacters, ...cur.mainCharacters]).slice(0, 8);
  const supportingCharacters = uniqueStrings([
    ...prev.supportingCharacters,
    ...cur.supportingCharacters,
  ])
    .filter((n) => !mainCharacters.includes(n))
    .slice(0, 12);

  return {
    ...prev,
    endChapter: cur.endChapter,
    sourceText: `${prev.sourceText}\n\n${cur.sourceText}`,
    summary: `${prev.summary} ${cur.summary}`.trim(),
    coreConflict: prev.coreConflict,
    turningPoints: uniqueStrings([...prev.turningPoints, ...cur.turningPoints]).slice(0, 12),
    resolution: cur.resolution ?? prev.resolution,
    conflictStatus: cur.conflictStatus,
    events: [...(prev.events ?? []), ...(cur.events ?? [])],
    mainCharacters,
    supportingCharacters,
    locations: uniqueStrings([...prev.locations, ...cur.locations]).slice(0, 10),
    boundaryConfidence: Math.max(prev.boundaryConfidence, cur.boundaryConfidence),
    boundaryDecisionIds: [
      ...prev.boundaryDecisionIds,
      ...cur.boundaryDecisionIds,
      `human-merge-${Date.now()}`,
    ],
    approved: false, // 合并后内容变化，必须重新审批
  };
}

export async function resolveBoundaryReview(
  bookId: string,
  ownerId: string,
  reviewId: string,
  decision: BoundaryDecision,
): Promise<{ item: BoundaryReviewApiItem; merged: boolean; pendingCount: number }> {
  await requireOwnedBook(bookId, ownerId);
  const reviewDoc = await loadReviewDoc(bookId);
  const item = reviewDoc.items.find((i) => i.id === reviewId);
  if (!item) throw new NotFoundError(`审核项不存在：${reviewId}`);
  if (item.status === 'resolved') throw new ConflictError('该审核项已裁决');
  if (decision === 'merge_with_previous' && !item.canMerge) {
    throw new BadRequestError('该段没有可合并的上一段');
  }

  let merged = false;
  if (decision === 'merge_with_previous') {
    const doc = await loadSegmentsDoc(bookId);
    if (!doc) throw new NotFoundError('尚未生成故事段');
    const sorted = [...doc.segments].sort(
      (a, b) => a.startChapter - b.startChapter || a.id.localeCompare(b.id),
    );
    const idx = sorted.findIndex((s) => s.id === item.segmentId);
    if (idx <= 0) throw new BadRequestError('该段没有可合并的上一段');

    const prev = sorted[idx - 1];
    const cur = sorted[idx];
    const mergedSeg = mergeSegments(prev, cur);
    doc.segments = sorted.filter((s) => s.id !== cur.id).map((s) => (s.id === prev.id ? mergedSeg : s));
    await writeStoryArtifact(bookId, 'story-segments.json', segmentsFile(bookId), doc);

    // 两段的旧资产都已失效
    await rm(storyDir(bookId, prev.id), { recursive: true, force: true });
    await rm(storyDir(bookId, cur.id), { recursive: true, force: true });

    // 引用被合并段的其他待审项自动随之失效
    for (const other of reviewDoc.items) {
      if (other.id !== item.id && other.status === 'pending' && other.segmentId === cur.id) {
        other.status = 'resolved';
        other.resolvedDecision = 'merge_with_previous';
      }
    }
    merged = true;
  }

  item.status = 'resolved';
  item.resolvedDecision = decision;
  await writeStoryArtifact(bookId, 'story-boundary-review.json', reviewFile(bookId), reviewDoc);

  const pendingCount = reviewDoc.items.filter((i) => i.status === 'pending').length;
  return { item, merged, pendingCount };
}

// ---------- 故事资产（同步：确定性提取，毫秒级） ----------

export async function extractAssets(bookId: string, ownerId: string, storyId: string): Promise<StoryAssetPack> {
  const seg = await requireOwnedStory(bookId, ownerId, storyId);
  if (!seg.approved) throw new ConflictError('故事段尚未审批，请先在故事页审批');

  const bundle = buildStoryAssetBundle(seg);
  const files = {
    story: bundle.story,
    characters: bundle.characters,
    scenes: bundle.scenes,
    props: bundle.props,
    assetPack: bundle.assetPack,
    assetPrompts: bundle.assetPrompts,
  };
  await writeStoryAssetFiles(OUTPUT_ROOT, files, bookId);
  await persistStoryAssetArtifacts(bookId, files);
  return bundle.assetPack;
}

export async function getAssetPack(bookId: string, ownerId: string, storyId: string): Promise<StoryAssetPack> {
  await requireOwnedStory(bookId, ownerId, storyId);
  const pack = await readStoryFile<StoryAssetPack>(bookId, storyId, 'asset-pack.json');
  if (!pack) throw new NotFoundError('资产尚未提取');
  return pack;
}

export async function getAssetPrompts(bookId: string, ownerId: string, storyId: string): Promise<StoryAssetPromptPack> {
  await requireOwnedStory(bookId, ownerId, storyId);
  const prompts = await readStoryFile<StoryAssetPromptPack>(bookId, storyId, 'asset-prompts.json');
  if (!prompts) throw new NotFoundError('资产尚未提取');
  return prompts;
}

export type AssetType = 'character' | 'scene' | 'prop';

export interface AssetPatch {
  description?: string;
  visualPrompt?: string;
  appearanceDescription?: string;
}

/** 与 story-assets.ts 内部 warningsForPack 相同的规则（该函数未导出）。 */
function rebuildWarnings(pack: Omit<StoryAssetPack, 'assetWarnings'>): AssetWarning[] {
  const warnings: AssetWarning[] = [];
  const pushRepair = (assetType: AssetWarning['assetType'], name: string, quality: string) =>
    warnings.push({
      assetType,
      assetName: name,
      issue: quality === 'missing' ? 'missing_description' : 'thin_description',
      message: `${name} 在生成图片前需要补充更完整的视觉描述。`,
    });
  const pushLowConfidence = (assetType: AssetWarning['assetType'], name: string, note: string) =>
    warnings.push({ assetType, assetName: name, issue: 'low_confidence', message: `${name} ${note}` });

  for (const c of pack.characters) {
    if (c.needsDescriptionRepair) pushRepair('character', c.name, c.descriptionQuality);
    if (c.confidence < 0.75) pushLowConfidence('character', c.name, '属于候选角色，审核前不应作为关键剧情视觉依据。');
  }
  for (const s of pack.scenes) {
    if (s.needsDescriptionRepair) pushRepair('scene', s.name, s.descriptionQuality);
    if (s.confidence < 0.75) pushLowConfidence('scene', s.name, '属于候选场景，仅可作为参考。');
  }
  for (const p of pack.props) {
    if (p.needsDescriptionRepair) pushRepair('prop', p.name, p.descriptionQuality);
    if (p.confidence < 0.75) pushLowConfidence('prop', p.name, '属于候选道具，仅可作为参考。');
  }
  return warnings;
}

export async function patchAsset(
  bookId: string,
  ownerId: string,
  storyId: string,
  assetType: AssetType,
  assetName: string,
  patch: AssetPatch,
): Promise<CharacterInStory | SceneInStory | PropInStory> {
  await requireOwnedStory(bookId, ownerId, storyId);
  const story = await readStoryFile<StorySegment>(bookId, storyId, 'story.json');
  const characters = await readStoryFile<StoryCharacterFile>(bookId, storyId, 'characters.json');
  const scenes = await readStoryFile<StorySceneFile>(bookId, storyId, 'scenes.json');
  const props = await readStoryFile<StoryPropFile>(bookId, storyId, 'props.json');
  if (!story || !characters || !scenes || !props) throw new NotFoundError('资产尚未提取');

  let target: CharacterInStory | SceneInStory | PropInStory | undefined;
  if (assetType === 'character') target = characters.characters.find((c) => c.name === assetName);
  else if (assetType === 'scene') target = scenes.scenes.find((s) => s.name === assetName);
  else target = props.props.find((p) => p.name === assetName);
  if (!target) throw new NotFoundError(`资产不存在：${assetType}/${assetName}`);

  if (patch.description !== undefined) {
    target.description = patch.description.trim();
    const quality = qualityFor(target.description);
    target.descriptionQuality = quality.descriptionQuality;
    target.needsDescriptionRepair = quality.needsDescriptionRepair;
  }
  if (patch.visualPrompt !== undefined) {
    target.visualPrompt = patch.visualPrompt.trim();
  }
  if (patch.appearanceDescription !== undefined && assetType === 'character') {
    const character = target as CharacterInStory;
    character.appearanceDescription = patch.appearanceDescription.trim();
    character.needsAppearanceRepair = character.appearanceDescription.length < 18;
  }

  const packBase = {
    storyId,
    bookId,
    characters: characters.characters,
    scenes: scenes.scenes,
    props: props.props,
  };
  const assetPack: StoryAssetPack = { ...packBase, assetWarnings: rebuildWarnings(packBase) };
  const assetPrompts = buildStoryAssetPromptPack(story, packBase);

  const patchFiles = { story, characters, scenes, props, assetPack, assetPrompts };
  await writeStoryAssetFiles(OUTPUT_ROOT, patchFiles, bookId);
  await persistStoryAssetArtifacts(bookId, patchFiles);
  return target;
}

// ---------- 导演管线（同步：确定性纯函数） ----------

async function readBundle(bookId: string, storyId: string): Promise<StoryAssetBundle> {
  const story = await readStoryFile<StorySegment>(bookId, storyId, 'story.json');
  const characters = await readStoryFile<StoryCharacterFile>(bookId, storyId, 'characters.json');
  const scenes = await readStoryFile<StorySceneFile>(bookId, storyId, 'scenes.json');
  const props = await readStoryFile<StoryPropFile>(bookId, storyId, 'props.json');
  const assetPack = await readStoryFile<StoryAssetPack>(bookId, storyId, 'asset-pack.json');
  const assetPrompts = await readStoryFile<StoryAssetPromptPack>(bookId, storyId, 'asset-prompts.json');
  if (!story || !characters || !scenes || !props || !assetPack || !assetPrompts) {
    throw new NotFoundError('资产文件不完整，请先提取资产');
  }
  return { story, characters, scenes, props, assetPack, assetPrompts };
}

export interface CreateAssignmentBody {
  assignmentType: DirectorAssignment['assignmentType'];
  storyIds: string[];
  objective: DirectorAssignment['objective'];
  styleNotes?: string[];
  constraints?: string[];
  episodeNos?: number[];
}

export async function createAssignment(
  bookId: string,
  ownerId: string,
  body: CreateAssignmentBody,
): Promise<AssignmentWithStatus> {
  await requireOwnedBook(bookId, ownerId);
  if (!body.storyIds?.length) throw new BadRequestError('storyIds 不能为空');

  const doc = await loadSegmentsDoc(bookId);
  if (!doc) throw new NotFoundError('尚未生成故事段');
  const notApproved: string[] = [];
  const targets: StorySegment[] = [];
  for (const storyId of body.storyIds) {
    const seg = doc.segments.find((s) => s.id === storyId);
    if (!seg) throw new NotFoundError(`故事段不存在：${storyId}`);
    if (!seg.approved) notApproved.push(storyId);
    else targets.push(seg);
  }
  if (notApproved.length > 0) {
    throw new BadRequestError(`以下故事段尚未审批：${notApproved.join(', ')}`);
  }

  const assignment: DirectorAssignment = {
    id: `assignment-${randomUUID().slice(0, 8)}`,
    bookId,
    assignmentType: body.assignmentType,
    storyIds: body.storyIds,
    episodeNos: body.episodeNos,
    objective: body.objective,
    styleNotes: body.styleNotes?.length ? body.styleNotes : undefined,
    constraints: body.constraints?.length ? body.constraints : undefined,
    requestedBy: 'user',
    createdAt: new Date().toISOString(),
  };

  const errors: string[] = [];
  for (const seg of targets) {
    try {
      // 资产未提取时先提取（同步、确定性）。BookArtifact 或本机 output/ 任一存在即跳过。
      const existingPack = await readStoryFile<StoryAssetPack>(bookId, seg.id, 'asset-pack.json');
      if (!existingPack) {
        await extractAssets(bookId, ownerId, seg.id);
      }
      // 从磁盘读 bundle，保留人工修复过的描述
      const bundle = await readBundle(bookId, seg.id);
      const directorResult = await runDirectorPipelineForStory(bundle, { outputDir: OUTPUT_ROOT, assignment });
      await persistDirectorArtifacts(bookId, seg.id, directorResult);
    } catch (err) {
      errors.push(`${seg.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const record: AssignmentWithStatus = {
    ...assignment,
    status: errors.length === 0 ? 'completed' : 'failed',
    error: errors.length > 0 ? errors.join('; ') : undefined,
  };

  const assignDoc =
    (await readArtifactJson<AssignmentsDoc>(bookId, 'director-assignments.json', assignmentsFile(bookId))) ?? { bookId, assignments: [] };
  assignDoc.assignments.unshift(record);
  await writeStoryArtifact(bookId, 'director-assignments.json', assignmentsFile(bookId), assignDoc);

  return record;
}

export async function listAssignments(bookId: string, ownerId: string): Promise<{ assignments: AssignmentWithStatus[] }> {
  await requireOwnedBook(bookId, ownerId);
  const doc = await readArtifactJson<AssignmentsDoc>(bookId, 'director-assignments.json', assignmentsFile(bookId));
  return { assignments: doc?.assignments ?? [] };
}

// ---------- 剧集产物读取 ----------

export interface EpisodesResponse {
  hasDirectorRun: boolean;
  plans: ScriptEpisodePlan[];
  episodes: ScriptEpisode[];
  review: ScriptReview | null;
}

export async function getEpisodes(bookId: string, ownerId: string, storyId: string): Promise<EpisodesResponse> {
  await requireOwnedStory(bookId, ownerId, storyId);
  const planDoc = await readDirectorFile<{ storyId: string; plans: ScriptEpisodePlan[] }>(
    bookId, storyId, 'episode-plan.json',
  );
  const episodeDoc = await readDirectorFile<{ storyId: string; episodes: ScriptEpisode[] }>(
    bookId, storyId, 'script-episodes.json',
  );
  const review = await readDirectorFile<ScriptReview>(bookId, storyId, 'script-review.json');
  return {
    hasDirectorRun: !!episodeDoc,
    plans: planDoc?.plans ?? [],
    episodes: episodeDoc?.episodes ?? [],
    review,
  };
}

export interface PromptPackResponse<T> {
  pack: T | null;
  reason?: 'not_generated' | 'review_blocked';
  review?: ScriptReview | null;
}

export async function getStoryboardPack(
  bookId: string,
  ownerId: string,
  storyId: string,
  episodeNo: number,
): Promise<PromptPackResponse<StoryboardPromptPack>> {
  await requireOwnedStory(bookId, ownerId, storyId);
  const pack = await readDirectorFile<StoryboardPromptPack>(bookId, storyId, 'storyboard-prompt-pack.json');
  if (pack && pack.episodeNo === episodeNo) return { pack };

  const review = await readDirectorFile<ScriptReview>(bookId, storyId, 'script-review.json');
  if (review && !review.accepted) return { pack: null, reason: 'review_blocked', review };
  return { pack: null, reason: 'not_generated', review: review ?? null };
}

export async function getVideoPromptPack(
  bookId: string,
  ownerId: string,
  storyId: string,
  episodeNo: number,
): Promise<PromptPackResponse<VideoPromptPack>> {
  await requireOwnedStory(bookId, ownerId, storyId);
  const pack = await readDirectorFile<VideoPromptPack>(bookId, storyId, 'video-prompt-pack.json');
  if (pack && pack.episodeNo === episodeNo) return { pack };

  const review = await readDirectorFile<ScriptReview>(bookId, storyId, 'script-review.json');
  if (review && !review.accepted) return { pack: null, reason: 'review_blocked', review };
  return { pack: null, reason: 'not_generated', review: review ?? null };
}
