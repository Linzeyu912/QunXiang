import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { BookRepository, NoiseOverrideRepository, getSharedAssetSourceResolver } from '@qunxiang/storage';
import type { Book } from '@qunxiang/core';
import { parseChapterOutline, getChapterCleanedContent, type ChapterOutlineResult, type ChapterContentResult } from '@qunxiang/import';
import { readArtifactJson, readArtifactText } from './artifact-store.js';

// 提取管线（description-fusion / visual-description / prompt-generation）把
// 富产物写在时间戳运行目录 output/{bookSlug}-{ts}/entities/ 下，DB 只存扁平
// description。本服务按 run-summary.json 里的 bookId 定位该书最新一次完整运行，
// 把三层产物按实体名索引后透出给前端实体审核页。
const OUTPUT_ROOT = 'output';

/** 结构化证据片段（与 scheduler 的 DescriptionEvidenceSnippet 对齐） */
export interface DescriptionEvidenceSnippet {
  chapterIndex: number;
  chapterTitle?: string;
  text: string;
  matchedNames: string[];
  otherMatchedNames?: string[];
  fields: string[];
}

/** *-descriptions.json 条目（description-fusion 产物） */
export interface FusedDescriptionEntry {
  entityType: string;
  name: string;
  aliases: string[];
  sourceDescription?: string;
  fields?: Record<string, string>;
  missingFields?: string[];
  evidenceSnippets?: DescriptionEvidenceSnippet[];
  sourceCoverage?: string;
  confidence?: number;
  needsReview?: boolean;
}

/** *-visual-descriptions.json 条目（visual-description 产物，含 fusion 字段超集） */
export interface VisualDescriptionEntry extends FusedDescriptionEntry {
  tier?: string;
  importanceScore?: number;
  visualFields?: Record<string, string>;
  visualDetails?: Record<string, string>;
  /** LLM 生成的概括性视觉描写段落 */
  enhancedDescription?: string;
  /** 最终使用的视觉描写（= enhancedDescription 或其 fallback） */
  finalDescription?: string;
  llmSupplement?: string;
  completionStatus?: string;
  descriptionSource?: string;
}

/** 单个年龄阶段的提示词版本（人物描写可溯源） */
export interface PromptVariantEntry {
  stage: string;
  label: string;
  prompt: string;
  outfit?: string;
  /** 溯源：该版本基于的原文章节区间 */
  sourceChapters?: string;
  /** 其余服饰套系（含章节区间） */
  outfitList?: string[];
  source?: string;
  isPrimary?: boolean;
}

/** *-prompts.json 条目（prompt-generation 产物） */
export interface GenerationPromptEntry {
  entityName: string;
  entityType: string;
  tier?: string;
  prompt: string;
  /** 角色的多个年龄阶段版本（仅 character；顶层 prompt = 主阶段） */
  variants?: PromptVariantEntry[];
  detectedStages?: string[];
  styleTags?: string[];
  source?: string;
  quality?: string;
  description?: string;
}

export interface EntityArtifacts {
  description?: FusedDescriptionEntry;
  visual?: VisualDescriptionEntry;
  prompt?: GenerationPromptEntry;
}

/** events.json 条目（叙事事件信号） */
export interface NarrativeEventEntry {
  text: string;
  chapterIndex: number;
  position?: number;
  source?: string;
  confidence?: number;
  totalCount?: number;
  allChapters?: number[];
}

export interface ExtractionArtifactsResponse {
  available: boolean;
  runDir?: string;
  generatedAt?: string;
  summaryMd?: string;
  allPromptsMd?: string;
  events: NarrativeEventEntry[];
  characters: Record<string, EntityArtifacts>;
  locations: Record<string, EntityArtifacts>;
  items: Record<string, EntityArtifacts>;
}

interface RunSummary {
  bookId: string;
  status?: string;
  officialResult?: boolean;
  generatedAt?: string;
  outputs?: {
    finalSummary?: string;
    prescanIntermediate?: string;
    entities?: string;
  };
}

async function readJsonSafe<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf-8')) as T;
  } catch {
    return null;
  }
}

async function readTextSafe(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf-8');
  } catch {
    return undefined;
  }
}

export interface ExtractionRunInfo {
  runDir: string;
  generatedAt: string;
  status?: string;
  counts?: { characters?: number; locations?: number; items?: number };
  isCurrent: boolean;
}

interface RunSummaryFull extends RunSummary {
  counts?: { characters?: number; locations?: number; items?: number };
}

export type PrescanEntityType = 'character' | 'location' | 'item' | 'event';

export interface PrescanMentionLine {
  chapterIndex: number;
  text: string;
  source: string;
  confidence: number;
}

export interface PrescanMentionFile {
  totalCount: number;
  sample: PrescanMentionLine[];
}

export interface PrescanImportanceRow {
  text: string;
  importance: number;
  confidence: number;
  tier: string;
  route: string;
  causal: number;
  uniqueness: number;
  transition: number;
  storyScore: number;
  storyValue: number;
  productionValue: number;
  mentionCount: number;
  chapters: number[];
}

export interface PrescanImportanceSection {
  type: PrescanEntityType;
  rows: PrescanImportanceRow[];
  tierSummary?: string;
  routeSummary?: string;
}

export interface PrescanImportanceReport {
  sections: PrescanImportanceSection[];
  rawPreview: string;
}

export interface PrescanArtifactsResponse {
  available: boolean;
  runDir?: string;
  generatedAt?: string;
  intermediateDir?: string;
  files: Record<PrescanEntityType, PrescanMentionFile>;
  importance?: PrescanImportanceReport;
}

const PRESCAN_TYPES: PrescanEntityType[] = ['character', 'location', 'item', 'event'];

const emptyPrescanFiles = (): Record<PrescanEntityType, PrescanMentionFile> => ({
  character: { totalCount: 0, sample: [] },
  location: { totalCount: 0, sample: [] },
  item: { totalCount: 0, sample: [] },
  event: { totalCount: 0, sample: [] },
});

export function parsePrescanEntityFile(content: string, sampleLimit = 30): PrescanMentionLine[] {
  const rows: PrescanMentionLine[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const parts = line.split('|');
    if (parts.length < 4) continue;
    const chapterIndex = Number(parts[0]);
    const confidence = Number(parts[parts.length - 1]);
    const source = parts[parts.length - 2];
    const text = parts.slice(1, -2).join('|');
    if (!Number.isFinite(chapterIndex) || !text || !Number.isFinite(confidence)) continue;

    rows.push({ chapterIndex, text, source, confidence });
    if (rows.length >= sampleLimit) break;
  }
  return rows;
}

export function parsePrescanImportanceReport(content: string): PrescanImportanceReport {
  const sections: PrescanImportanceSection[] = [];
  let current: PrescanImportanceSection | undefined;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const sectionMatch = line.match(/^===\s+(CHARACTER|LOCATION|ITEM|EVENT)\s+\(\d+条\)\s+===$/i);
    if (sectionMatch) {
      current = { type: sectionMatch[1].toLowerCase() as PrescanEntityType, rows: [] };
      sections.push(current);
      continue;
    }
    if (!current) continue;

    if (line.startsWith('[分层统计]')) {
      current.tierSummary = line;
      continue;
    }
    if (line.startsWith('[分流统计]')) {
      current.routeSummary = line;
      continue;
    }
    if (line.startsWith('实体|')) continue;

    const parts = line.split('|');
    if (parts.length < 13) continue;
    const [
      text,
      importance,
      confidence,
      tier,
      route,
      causal,
      uniqueness,
      transition,
      storyScore,
      storyValue,
      productionValue,
      mentionCount,
      chapters,
    ] = parts;

    current.rows.push({
      text,
      importance: Number(importance),
      confidence: Number(confidence),
      tier,
      route,
      causal: Number(causal),
      uniqueness: Number(uniqueness),
      transition: Number(transition),
      storyScore: Number(storyScore),
      storyValue: Number(storyValue),
      productionValue: Number(productionValue),
      mentionCount: Number(mentionCount),
      chapters: chapters
        .split(',')
        .map((chapter) => Number(chapter))
        .filter((chapter) => Number.isFinite(chapter)),
    });
  }

  return {
    sections,
    rawPreview: content.slice(0, 12_000),
  };
}

/** 该书全部官方运行（generatedAt 倒序），用于管道页运行历史。 */
export async function listExtractionRuns(bookId: string, ownerId: string): Promise<{ runs: ExtractionRunInfo[] }> {
  if (!(await BookRepository.findOwnedById(bookId, ownerId))) return { runs: [] };
  let entries: string[];
  try {
    entries = await readdir(OUTPUT_ROOT);
  } catch {
    entries = [];
  }

  const runs: ExtractionRunInfo[] = [];
  for (const entry of entries) {
    const summary = await readJsonSafe<RunSummaryFull>(
      join(OUTPUT_ROOT, entry, 'final', 'run-summary.json'),
    );
    if (!summary || summary.bookId !== bookId || summary.officialResult === false) continue;
    runs.push({
      runDir: entry,
      generatedAt: summary.generatedAt ?? '',
      status: summary.status,
      counts: summary.counts,
      isCurrent: false,
    });
  }
  runs.sort((a, b) => (a.generatedAt < b.generatedAt ? 1 : -1));

  // 优先以 BookArtifact 中的 run-summary.json（最新 run 覆盖写入）确定 current；
  // 从 outputs.finalSummary（output/{dirName}/final/run-summary.json）解析 dirName。
  const artifactSummary = await readArtifactJson<RunSummaryFull>(bookId, 'run-summary.json');
  let currentSet = false;
  if (artifactSummary && artifactSummary.bookId === bookId && artifactSummary.officialResult !== false) {
    const dirName = parseRunDirName(artifactSummary);
    if (dirName) {
      const existing = runs.find((r) => r.runDir === dirName);
      if (existing) {
        existing.isCurrent = true;
      } else {
        runs.unshift({
          runDir: dirName,
          generatedAt: artifactSummary.generatedAt ?? '',
          status: artifactSummary.status,
          counts: artifactSummary.counts,
          isCurrent: true,
        });
      }
      currentSet = true;
    }
  }
  if (!currentSet && runs[0]) runs[0].isCurrent = true; // 回退：本机最新一次
  return { runs };
}

/** 从 run-summary.outputs.finalSummary（output/{dirName}/final/run-summary.json）解析 dirName。 */
function parseRunDirName(summary: RunSummary): string | null {
  const finalSummary = summary.outputs?.finalSummary;
  if (typeof finalSummary !== 'string') return null;
  const match = finalSummary.match(/output\/(.+)\/final\/run-summary\.json$/);
  return match?.[1] ?? null;
}

/** 找到该书 generatedAt 最新的官方运行目录（含 final/run-summary.json）。 */
async function findLatestRunDir(bookId: string, ownerId: string): Promise<{ dir: string; generatedAt: string } | null> {
  const { runs } = await listExtractionRuns(bookId, ownerId);
  return runs[0] ? { dir: runs[0].runDir, generatedAt: runs[0].generatedAt } : null;
}

function emptyResponse(): ExtractionArtifactsResponse {
  return { available: false, events: [], characters: {}, locations: {}, items: {} };
}

// ---------- 章节大纲（实时解析 + mtime 缓存，可视化管线第一步） ----------

export interface ChapterOutlineResponse extends ChapterOutlineResult {
  bookId: string;
}

// 大书原文和解析结果单条可达数 MB，使用有上限的 LRU，避免多书访问后持续占用内存。
const CHAPTER_OUTLINE_CACHE_MAX = 32;
const CHAPTER_CONTENT_CACHE_MAX = 128;
const SOURCE_TEXT_CACHE_MAX = 8;

function lruSet<K, V>(map: Map<K, V>, key: K, value: V, max: number): void {
  map.delete(key);
  map.set(key, value);
  while (map.size > max) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

const chapterCache = new Map<string, { mtimeMs: number; outline: ChapterOutlineResponse }>();
const chapterContentCache = new Map<string, ChapterContentResponse>();
const sourceTextCache = new Map<string, string>();

async function readSourceTextCached(book: Book, version: string): Promise<string> {
  const hit = sourceTextCache.get(version);
  if (hit !== undefined) return hit;
  const content = await getSharedAssetSourceResolver().readSourceText(book);
  lruSet(sourceTextCache, version, content, SOURCE_TEXT_CACHE_MAX);
  return content;
}

export async function getChapterOutline(bookId: string, ownerId: string): Promise<ChapterOutlineResponse | null> {
  const book = await BookRepository.findOwnedById(bookId, ownerId);
  if (!book) return null;

  const keepLines = await NoiseOverrideRepository.listOwnedKeepLineNums(bookId, ownerId);
  // 对象存储原文不可变：用 sourceObjectKey 作版本；旧书回退本机 mtime
  let version: string | null = null;
  if (book.sourceObjectKey) {
    version = book.sourceObjectKey;
  } else if (book.filePath) {
    const fileStat = await stat(book.filePath).catch(() => null);
    version = fileStat ? `${book.filePath}:${fileStat.mtimeMs}` : null;
  }
  if (!version) return null;

  // 缓存 key 含 overrides 数量：找回/取消找回后数量变化即失效
  const cacheKey = `${bookId}:${version}:${keepLines.size}`;
  const cached = chapterCache.get(cacheKey);
  if (cached) return cached.outline;

  const content = await readSourceTextCached(book, version);
  const outline: ChapterOutlineResponse = {
    bookId,
    ...parseChapterOutline(content, book.title, keepLines),
  };
  lruSet(chapterCache, cacheKey, { mtimeMs: 0, outline }, CHAPTER_OUTLINE_CACHE_MAX);
  return outline;
}

/** 单章清洗后内容响应（前端正文阅读 + 噪声高亮）。 */
export interface ChapterContentResponse extends ChapterContentResult {
  bookId: string;
}

/** 读取单章正文（含被标记噪声行，供前端高亮阅读）。按章懒加载并缓存结果。 */
export async function getChapterContent(
  bookId: string,
  ownerId: string,
  chapterIndex: number,
): Promise<ChapterContentResponse | null> {
  const book = await BookRepository.findOwnedById(bookId, ownerId);
  if (!book) return null;

  const keepLines = await NoiseOverrideRepository.listOwnedKeepLineNums(bookId, ownerId);

  let version: string | null = null;
  if (book.sourceObjectKey) {
    version = book.sourceObjectKey;
  } else if (book.filePath) {
    const fileStat = await stat(book.filePath).catch(() => null);
    version = fileStat ? `${book.filePath}:${fileStat.mtimeMs}` : null;
  }
  if (!version) return null;

  const cacheKey = `${bookId}:${version}:${keepLines.size}:${chapterIndex}`;
  const cached = chapterContentCache.get(cacheKey);
  if (cached) return cached;

  const content = await readSourceTextCached(book, version).catch(() => null);
  if (content === null) return null;

  const result = getChapterCleanedContent(content, book.title, chapterIndex, keepLines);
  if (!result) return null;
  const response: ChapterContentResponse = { bookId, ...result };
  lruSet(chapterContentCache, cacheKey, response, CHAPTER_CONTENT_CACHE_MAX);
  return response;
}

/** 找回（保留）某行噪声：写入覆盖标记，并失效该书的大纲缓存。 */
export async function restoreNoiseLine(bookId: string, ownerId: string, lineNum: number): Promise<boolean> {
  const changed = await NoiseOverrideRepository.upsertOwnedKeep(bookId, ownerId, lineNum);
  invalidateChapterCache(bookId);
  return changed;
}

/** 取消找回：删除覆盖标记，并失效大纲缓存。 */
export async function unrestoreNoiseLine(bookId: string, ownerId: string, lineNum: number): Promise<boolean> {
  const changed = await NoiseOverrideRepository.removeOwned(bookId, ownerId, lineNum);
  invalidateChapterCache(bookId);
  return changed;
}

/** 失效某书的全部章节缓存条目（找回/取消找回后调用）。 */
function invalidateChapterCache(bookId: string): void {
  for (const key of chapterCache.keys()) {
    if (key.startsWith(`${bookId}:`)) chapterCache.delete(key);
  }
  for (const key of chapterContentCache.keys()) {
    if (key.startsWith(`${bookId}:`)) chapterContentCache.delete(key);
  }
}

export async function getPrescanArtifacts(bookId: string, ownerId: string): Promise<PrescanArtifactsResponse> {
  const run = await findLatestRunDir(bookId, ownerId);
  if (!run) return { available: false, files: emptyPrescanFiles() };

  const summary = await readJsonSafe<RunSummaryFull>(
    join(OUTPUT_ROOT, run.dir, 'final', 'run-summary.json'),
  );
  const prescanPath = summary?.outputs?.prescanIntermediate ?? join('.intermediate', run.dir, 'prescan');
  const prescanDir = isAbsolute(prescanPath) ? prescanPath : resolve(prescanPath);

  const files = emptyPrescanFiles();
  for (const type of PRESCAN_TYPES) {
    const content = await readTextSafe(join(prescanDir, `${type}.txt`));
    if (!content) continue;
    files[type] = {
      totalCount: content.split(/\r?\n/).filter((line) => line.trim()).length,
      sample: parsePrescanEntityFile(content),
    };
  }

  const importanceText = await readTextSafe(join(prescanDir, 'importance.txt'));

  return {
    available: true,
    runDir: run.dir,
    generatedAt: run.generatedAt,
    intermediateDir: prescanPath,
    files,
    importance: importanceText ? parsePrescanImportanceReport(importanceText) : undefined,
  };
}

export async function getExtractionArtifacts(bookId: string, ownerId: string): Promise<ExtractionArtifactsResponse> {
  const run = await findLatestRunDir(bookId, ownerId);
  if (!run) return emptyResponse();

  const entitiesDir = join(OUTPUT_ROOT, run.dir, 'entities');
  // 各 entities/*.json：优先 BookArtifact + 对象存储，回退本机 output/{runDir}/entities/。
  const readEntityJson = <T>(filename: string) =>
    readArtifactJson<T>(bookId, `entities/${filename}`, join(entitiesDir, filename));
  const readEntityText = (filename: string) =>
    readArtifactText(bookId, `entities/${filename}`, join(entitiesDir, filename));

  const response: ExtractionArtifactsResponse = {
    available: true,
    runDir: run.dir,
    generatedAt: run.generatedAt,
    summaryMd: (await readEntityText('summary.md')) ?? undefined,
    allPromptsMd: (await readEntityText('all-prompts.md')) ?? undefined,
    events: (await readEntityJson<NarrativeEventEntry[]>('events.json')) ?? [],
    characters: {},
    locations: {},
    items: {},
  };

  const buckets: Array<{ prefix: 'character' | 'location' | 'item'; target: Record<string, EntityArtifacts> }> = [
    { prefix: 'character', target: response.characters },
    { prefix: 'location', target: response.locations },
    { prefix: 'item', target: response.items },
  ];

  for (const { prefix, target } of buckets) {
    const descriptions = await readEntityJson<FusedDescriptionEntry[]>(`${prefix}-descriptions.json`);
    const visuals = await readEntityJson<VisualDescriptionEntry[]>(`${prefix}-visual-descriptions.json`);
    const prompts = await readEntityJson<GenerationPromptEntry[]>(`${prefix}-prompts.json`);

    for (const d of descriptions ?? []) {
      if (!d?.name) continue;
      (target[d.name] ??= {}).description = d;
    }
    for (const v of visuals ?? []) {
      if (!v?.name) continue;
      (target[v.name] ??= {}).visual = v;
    }
    for (const p of prompts ?? []) {
      if (!p?.entityName) continue;
      (target[p.entityName] ??= {}).prompt = p;
    }
  }

  return response;
}

// ── 产物人工编辑 ──

/** 可编辑的描写字段 */
export interface VisualDescriptionPatch {
  enhancedDescription?: string;
  llmSupplement?: string;
  visualFields?: Record<string, string>;
  visualDetails?: Record<string, string>;
}

/** 可编辑的提示词字段 */
export interface PromptPatch {
  prompt?: string;
  variants?: Array<{ stage: string; prompt: string }>;
}

export interface ArtifactPatch {
  visual?: VisualDescriptionPatch;
  prompt?: PromptPatch;
}

/**
 * 更新指定实体的产物（描写 / 提示词）。
 * 按 entityName 定位 JSON 文件中的条目，合并更新后写回。
 */
export async function updateArtifact(
  bookId: string,
  ownerId: string,
  entityType: 'character' | 'location' | 'item',
  entityName: string,
  patch: ArtifactPatch,
): Promise<{ success: boolean; error?: string }> {
  const run = await findLatestRunDir(bookId, ownerId);
  if (!run) return { success: false, error: '未找到提取运行记录' };

  const entitiesDir = join(OUTPUT_ROOT, run.dir, 'entities');

  // 更新 visual-descriptions.json
  if (patch.visual) {
    const filePath = join(entitiesDir, `${entityType}-visual-descriptions.json`);
    const entries = await readJsonSafe<VisualDescriptionEntry[]>(filePath);
    if (entries) {
      const idx = entries.findIndex((e) => e.name === entityName);
      if (idx !== -1) {
        const entry = entries[idx];
        if (patch.visual.enhancedDescription !== undefined) entry.enhancedDescription = patch.visual.enhancedDescription;
        if (patch.visual.llmSupplement !== undefined) entry.llmSupplement = patch.visual.llmSupplement;
        if (patch.visual.visualFields) entry.visualFields = { ...(entry.visualFields ?? {}), ...patch.visual.visualFields };
        if (patch.visual.visualDetails) entry.visualDetails = { ...(entry.visualDetails ?? {}), ...patch.visual.visualDetails };
        entries[idx] = entry;
        await writeFile(filePath, JSON.stringify(entries, null, 2), 'utf-8');
      } else {
        return { success: false, error: `实体「${entityName}」不在描写文件中` };
      }
    }
  }

  // 更新 prompts.json
  if (patch.prompt) {
    const filePath = join(entitiesDir, `${entityType}-prompts.json`);
    const entries = await readJsonSafe<GenerationPromptEntry[]>(filePath);
    if (entries) {
      const idx = entries.findIndex((e) => e.entityName === entityName);
      if (idx !== -1) {
        const entry = entries[idx];
        if (patch.prompt.prompt !== undefined) entry.prompt = patch.prompt.prompt;
        if (patch.prompt.variants && entry.variants) {
          for (const vPatch of patch.prompt.variants) {
            const vIdx = entry.variants.findIndex((v) => v.stage === vPatch.stage);
            if (vIdx !== -1) entry.variants[vIdx].prompt = vPatch.prompt;
          }
        }
        entries[idx] = entry;
        await writeFile(filePath, JSON.stringify(entries, null, 2), 'utf-8');
      } else {
        return { success: false, error: `实体「${entityName}」不在提示词文件中` };
      }
    }
  }

  return { success: true };
}
