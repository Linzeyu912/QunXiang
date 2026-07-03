import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { BookRepository } from '@novel-agent/storage';
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

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf-8')) as T;
  } catch {
    return null;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
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

export async function startSegmentation(
  bookId: string,
  options: SegmentationOptions = {},
): Promise<{ taskId: string; existing: boolean }> {
  for (const task of tasks.values()) {
    if (task.bookId === bookId && task.status === 'running') {
      return { taskId: task.id, existing: true };
    }
  }

  const book = await BookRepository.findById(bookId);
  if (!book) throw new NotFoundError(`Book not found: ${bookId}`);

  const task: StoryTask = {
    id: `story-seg-${randomUUID().slice(0, 8)}`,
    bookId,
    kind: 'segment',
    status: 'running',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  tasks.set(task.id, task);

  void runSegmentation(task, book.filePath, book.title, options).catch((err) => {
    touchTask(task, { status: 'failed', error: String(err) });
    emit(bookId, { type: 'error', taskId: task.id, message: String(err), timestamp: Date.now() });
  });

  return { taskId: task.id, existing: false };
}

async function runSegmentation(
  task: StoryTask,
  filePath: string,
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
  const content = await readFile(filePath, 'utf-8');
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
  await writeJson(segmentsFile(bookId), doc);
  await writeJson(reviewFile(bookId), { bookId, items: reviews } satisfies ReviewDoc);
  stageDone('segment-assembly', `共 ${segments.length} 段`);

  const pending = reviews.filter((r) => r.status === 'pending').length;
  if (pending > 0) {
    emit(bookId, { type: 'review-needed', taskId: task.id, pendingCount: pending, timestamp: Date.now() });
  }

  touchTask(task, { status: 'completed', stage: undefined, message: `共 ${segments.length} 段` });
  emit(bookId, { type: 'done', taskId: task.id, timestamp: Date.now() });
}

export function getSegmentationStatus(taskId: string): StoryTask | null {
  return tasks.get(taskId) ?? null;
}

/** SSE 流：转发本书的故事管线事件，terminal 事件后关闭。 */
export async function* createStoryStream(bookId: string): AsyncGenerator<string> {
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

async function loadSegmentsDoc(bookId: string): Promise<SegmentsDoc | null> {
  return readJson<SegmentsDoc>(segmentsFile(bookId));
}

async function loadReviewDoc(bookId: string): Promise<ReviewDoc> {
  return (await readJson<ReviewDoc>(reviewFile(bookId))) ?? { bookId, items: [] };
}

function stripSource(seg: StorySegment): Omit<StorySegment, 'sourceText'> {
  const { sourceText: _sourceText, ...rest } = seg;
  return rest;
}

function toSummary(bookId: string, seg: StorySegment): StorySummary {
  return {
    ...stripSource(seg),
    assetsExtracted: existsSync(join(storyDir(bookId, seg.id), 'asset-pack.json')),
    directorRan: existsSync(join(storyDir(bookId, seg.id), 'director', 'script-episodes.json')),
  };
}

export async function listStories(bookId: string): Promise<{
  stories: StorySummary[];
  pendingBoundaryReviews: number;
  generatedAt: string | null;
}> {
  const doc = await loadSegmentsDoc(bookId);
  const review = await loadReviewDoc(bookId);
  const sorted = [...(doc?.segments ?? [])].sort(
    (a, b) => a.startChapter - b.startChapter || a.id.localeCompare(b.id),
  );
  return {
    stories: sorted.map((s) => toSummary(bookId, s)),
    pendingBoundaryReviews: review.items.filter((i) => i.status === 'pending').length,
    generatedAt: doc?.generatedAt ?? null,
  };
}

export async function getStory(
  bookId: string,
  storyId: string,
  includeSource: boolean,
): Promise<StorySegment | Omit<StorySegment, 'sourceText'>> {
  const doc = await loadSegmentsDoc(bookId);
  const seg = doc?.segments.find((s) => s.id === storyId);
  if (!seg) throw new NotFoundError(`Story not found: ${storyId}`);
  return includeSource ? seg : stripSource(seg);
}

export async function approveStory(
  bookId: string,
  storyId: string,
  approved: boolean,
): Promise<StorySummary> {
  const doc = await loadSegmentsDoc(bookId);
  if (!doc) throw new NotFoundError('No story segments yet');
  const seg = doc.segments.find((s) => s.id === storyId);
  if (!seg) throw new NotFoundError(`Story not found: ${storyId}`);

  if (approved) {
    const review = await loadReviewDoc(bookId);
    const pending = review.items.find((i) => i.segmentId === storyId && i.status === 'pending');
    if (pending) {
      throw new ConflictError('该故事段仍有待裁决的边界审核项，请先完成边界审核');
    }
  }

  seg.approved = approved;
  await writeJson(segmentsFile(bookId), doc);
  return toSummary(bookId, seg);
}

export async function approveStoriesBatch(
  bookId: string,
  storyIds: string[],
  approved: boolean,
): Promise<{ updated: string[]; skipped: { storyId: string; reason: string }[] }> {
  const updated: string[] = [];
  const skipped: { storyId: string; reason: string }[] = [];
  for (const storyId of storyIds) {
    try {
      await approveStory(bookId, storyId, approved);
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
  status?: 'pending' | 'resolved',
): Promise<{ items: BoundaryReviewApiItem[] }> {
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
  reviewId: string,
  decision: BoundaryDecision,
): Promise<{ item: BoundaryReviewApiItem; merged: boolean; pendingCount: number }> {
  const reviewDoc = await loadReviewDoc(bookId);
  const item = reviewDoc.items.find((i) => i.id === reviewId);
  if (!item) throw new NotFoundError(`Review item not found: ${reviewId}`);
  if (item.status === 'resolved') throw new ConflictError('该审核项已裁决');
  if (decision === 'merge_with_previous' && !item.canMerge) {
    throw new BadRequestError('该段没有可合并的上一段');
  }

  let merged = false;
  if (decision === 'merge_with_previous') {
    const doc = await loadSegmentsDoc(bookId);
    if (!doc) throw new NotFoundError('No story segments yet');
    const sorted = [...doc.segments].sort(
      (a, b) => a.startChapter - b.startChapter || a.id.localeCompare(b.id),
    );
    const idx = sorted.findIndex((s) => s.id === item.segmentId);
    if (idx <= 0) throw new BadRequestError('该段没有可合并的上一段');

    const prev = sorted[idx - 1];
    const cur = sorted[idx];
    const mergedSeg = mergeSegments(prev, cur);
    doc.segments = sorted.filter((s) => s.id !== cur.id).map((s) => (s.id === prev.id ? mergedSeg : s));
    await writeJson(segmentsFile(bookId), doc);

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
  await writeJson(reviewFile(bookId), reviewDoc);

  const pendingCount = reviewDoc.items.filter((i) => i.status === 'pending').length;
  return { item, merged, pendingCount };
}

// ---------- 故事资产（同步：确定性提取，毫秒级） ----------

export async function extractAssets(bookId: string, storyId: string): Promise<StoryAssetPack> {
  const doc = await loadSegmentsDoc(bookId);
  const seg = doc?.segments.find((s) => s.id === storyId);
  if (!seg) throw new NotFoundError(`Story not found: ${storyId}`);
  if (!seg.approved) throw new ConflictError('故事段尚未审批，请先在故事页审批');

  const bundle = buildStoryAssetBundle(seg);
  await writeStoryAssetFiles(
    OUTPUT_ROOT,
    {
      story: bundle.story,
      characters: bundle.characters,
      scenes: bundle.scenes,
      props: bundle.props,
      assetPack: bundle.assetPack,
      assetPrompts: bundle.assetPrompts,
    },
    bookId,
  );
  return bundle.assetPack;
}

export async function getAssetPack(bookId: string, storyId: string): Promise<StoryAssetPack> {
  const pack = await readJson<StoryAssetPack>(join(storyDir(bookId, storyId), 'asset-pack.json'));
  if (!pack) throw new NotFoundError('资产尚未提取');
  return pack;
}

export async function getAssetPrompts(bookId: string, storyId: string): Promise<StoryAssetPromptPack> {
  const prompts = await readJson<StoryAssetPromptPack>(
    join(storyDir(bookId, storyId), 'asset-prompts.json'),
  );
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
      message: `${name} needs a stronger visual description before image generation.`,
    });
  const pushLowConfidence = (assetType: AssetWarning['assetType'], name: string, note: string) =>
    warnings.push({ assetType, assetName: name, issue: 'low_confidence', message: `${name} ${note}` });

  for (const c of pack.characters) {
    if (c.needsDescriptionRepair) pushRepair('character', c.name, c.descriptionQuality);
    if (c.confidence < 0.75) pushLowConfidence('character', c.name, 'is a candidate character and should not drive plot-critical visuals without review.');
  }
  for (const s of pack.scenes) {
    if (s.needsDescriptionRepair) pushRepair('scene', s.name, s.descriptionQuality);
    if (s.confidence < 0.75) pushLowConfidence('scene', s.name, 'is a candidate scene and should be treated as reference only.');
  }
  for (const p of pack.props) {
    if (p.needsDescriptionRepair) pushRepair('prop', p.name, p.descriptionQuality);
    if (p.confidence < 0.75) pushLowConfidence('prop', p.name, 'is a candidate prop and should be treated as reference only.');
  }
  return warnings;
}

export async function patchAsset(
  bookId: string,
  storyId: string,
  assetType: AssetType,
  assetName: string,
  patch: AssetPatch,
): Promise<CharacterInStory | SceneInStory | PropInStory> {
  const dir = storyDir(bookId, storyId);
  const story = await readJson<StorySegment>(join(dir, 'story.json'));
  const characters = await readJson<StoryCharacterFile>(join(dir, 'characters.json'));
  const scenes = await readJson<StorySceneFile>(join(dir, 'scenes.json'));
  const props = await readJson<StoryPropFile>(join(dir, 'props.json'));
  if (!story || !characters || !scenes || !props) throw new NotFoundError('资产尚未提取');

  let target: CharacterInStory | SceneInStory | PropInStory | undefined;
  if (assetType === 'character') target = characters.characters.find((c) => c.name === assetName);
  else if (assetType === 'scene') target = scenes.scenes.find((s) => s.name === assetName);
  else target = props.props.find((p) => p.name === assetName);
  if (!target) throw new NotFoundError(`Asset not found: ${assetType}/${assetName}`);

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

  await writeStoryAssetFiles(
    OUTPUT_ROOT,
    { story, characters, scenes, props, assetPack, assetPrompts },
    bookId,
  );
  return target;
}

// ---------- 导演管线（同步：确定性纯函数） ----------

async function readBundle(bookId: string, storyId: string): Promise<StoryAssetBundle> {
  const dir = storyDir(bookId, storyId);
  const story = await readJson<StorySegment>(join(dir, 'story.json'));
  const characters = await readJson<StoryCharacterFile>(join(dir, 'characters.json'));
  const scenes = await readJson<StorySceneFile>(join(dir, 'scenes.json'));
  const props = await readJson<StoryPropFile>(join(dir, 'props.json'));
  const assetPack = await readJson<StoryAssetPack>(join(dir, 'asset-pack.json'));
  const assetPrompts = await readJson<StoryAssetPromptPack>(join(dir, 'asset-prompts.json'));
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
  body: CreateAssignmentBody,
): Promise<AssignmentWithStatus> {
  if (!body.storyIds?.length) throw new BadRequestError('storyIds 不能为空');

  const doc = await loadSegmentsDoc(bookId);
  if (!doc) throw new NotFoundError('No story segments yet');
  const notApproved: string[] = [];
  const targets: StorySegment[] = [];
  for (const storyId of body.storyIds) {
    const seg = doc.segments.find((s) => s.id === storyId);
    if (!seg) throw new NotFoundError(`Story not found: ${storyId}`);
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
      // 资产未提取时先提取（同步、确定性）
      if (!existsSync(join(storyDir(bookId, seg.id), 'asset-pack.json'))) {
        await extractAssets(bookId, seg.id);
      }
      // 从磁盘读 bundle，保留人工修复过的描述
      const bundle = await readBundle(bookId, seg.id);
      await runDirectorPipelineForStory(bundle, { outputDir: OUTPUT_ROOT, assignment });
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
    (await readJson<AssignmentsDoc>(assignmentsFile(bookId))) ?? { bookId, assignments: [] };
  assignDoc.assignments.unshift(record);
  await writeJson(assignmentsFile(bookId), assignDoc);

  return record;
}

export async function listAssignments(bookId: string): Promise<{ assignments: AssignmentWithStatus[] }> {
  const doc = await readJson<AssignmentsDoc>(assignmentsFile(bookId));
  return { assignments: doc?.assignments ?? [] };
}

// ---------- 剧集产物读取 ----------

export interface EpisodesResponse {
  hasDirectorRun: boolean;
  plans: ScriptEpisodePlan[];
  episodes: ScriptEpisode[];
  review: ScriptReview | null;
}

export async function getEpisodes(bookId: string, storyId: string): Promise<EpisodesResponse> {
  const dir = join(storyDir(bookId, storyId), 'director');
  const planDoc = await readJson<{ storyId: string; plans: ScriptEpisodePlan[] }>(
    join(dir, 'episode-plan.json'),
  );
  const episodeDoc = await readJson<{ storyId: string; episodes: ScriptEpisode[] }>(
    join(dir, 'script-episodes.json'),
  );
  const review = await readJson<ScriptReview>(join(dir, 'script-review.json'));
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
  storyId: string,
  episodeNo: number,
): Promise<PromptPackResponse<StoryboardPromptPack>> {
  const dir = join(storyDir(bookId, storyId), 'director');
  const pack = await readJson<StoryboardPromptPack>(join(dir, 'storyboard-prompt-pack.json'));
  if (pack && pack.episodeNo === episodeNo) return { pack };

  const review = await readJson<ScriptReview>(join(dir, 'script-review.json'));
  if (review && !review.accepted) return { pack: null, reason: 'review_blocked', review };
  return { pack: null, reason: 'not_generated', review: review ?? null };
}

export async function getVideoPromptPack(
  bookId: string,
  storyId: string,
  episodeNo: number,
): Promise<PromptPackResponse<VideoPromptPack>> {
  const dir = join(storyDir(bookId, storyId), 'director');
  const pack = await readJson<VideoPromptPack>(join(dir, 'video-prompt-pack.json'));
  if (pack && pack.episodeNo === episodeNo) return { pack };

  const review = await readJson<ScriptReview>(join(dir, 'script-review.json'));
  if (review && !review.accepted) return { pack: null, reason: 'review_blocked', review };
  return { pack: null, reason: 'not_generated', review: review ?? null };
}
