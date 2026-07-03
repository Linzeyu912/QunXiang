import { readdir, readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { BookRepository } from '@novel-agent/storage';
import { parseChapterOutline, type ChapterOutlineResult } from '@novel-agent/import';

// 提取管线（description-fusion / visual-description / prompt-generation）把
// 富产物写在时间戳运行目录 output/{bookSlug}-{ts}/entities/ 下，DB 只存扁平
// description。本服务按 run-summary.json 里的 bookId 定位该书最新一次完整运行，
// 把三层产物按实体名索引后透出给前端实体审核页。
const OUTPUT_ROOT = 'output';

/** *-descriptions.json 条目（description-fusion 产物） */
export interface FusedDescriptionEntry {
  entityType: string;
  name: string;
  aliases: string[];
  sourceDescription?: string;
  fields?: Record<string, string>;
  missingFields?: string[];
  evidenceSnippets?: string[];
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
}

/** *-prompts.json 条目（prompt-generation 产物） */
export interface GenerationPromptEntry {
  entityName: string;
  entityType: string;
  tier?: string;
  prompt: string;
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
export async function listExtractionRuns(bookId: string): Promise<{ runs: ExtractionRunInfo[] }> {
  let entries: string[];
  try {
    entries = await readdir(OUTPUT_ROOT);
  } catch {
    return { runs: [] };
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
  if (runs[0]) runs[0].isCurrent = true; // 最新一次即 artifacts 端点采用的运行
  return { runs };
}

/** 找到该书 generatedAt 最新的官方运行目录（含 final/run-summary.json）。 */
async function findLatestRunDir(bookId: string): Promise<{ dir: string; generatedAt: string } | null> {
  const { runs } = await listExtractionRuns(bookId);
  return runs[0] ? { dir: runs[0].runDir, generatedAt: runs[0].generatedAt } : null;
}

function emptyResponse(): ExtractionArtifactsResponse {
  return { available: false, events: [], characters: {}, locations: {}, items: {} };
}

// ---------- 章节大纲（实时解析 + mtime 缓存，可视化管线第一步） ----------

export interface ChapterOutlineResponse extends ChapterOutlineResult {
  bookId: string;
}

const chapterCache = new Map<string, { mtimeMs: number; outline: ChapterOutlineResponse }>();

export async function getChapterOutline(bookId: string): Promise<ChapterOutlineResponse | null> {
  const book = await BookRepository.findById(bookId);
  if (!book) return null;

  const fileStat = await stat(book.filePath).catch(() => null);
  if (!fileStat) return null;

  const cached = chapterCache.get(bookId);
  if (cached && cached.mtimeMs === fileStat.mtimeMs) return cached.outline;

  const content = await readFile(book.filePath, 'utf-8');
  const outline: ChapterOutlineResponse = { bookId, ...parseChapterOutline(content, book.title) };
  chapterCache.set(bookId, { mtimeMs: fileStat.mtimeMs, outline });
  return outline;
}

export async function getPrescanArtifacts(bookId: string): Promise<PrescanArtifactsResponse> {
  const run = await findLatestRunDir(bookId);
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

export async function getExtractionArtifacts(bookId: string): Promise<ExtractionArtifactsResponse> {
  const run = await findLatestRunDir(bookId);
  if (!run) return emptyResponse();

  const entitiesDir = join(OUTPUT_ROOT, run.dir, 'entities');
  const response: ExtractionArtifactsResponse = {
    available: true,
    runDir: run.dir,
    generatedAt: run.generatedAt,
    summaryMd: await readTextSafe(join(entitiesDir, 'summary.md')),
    allPromptsMd: await readTextSafe(join(entitiesDir, 'all-prompts.md')),
    events: (await readJsonSafe<NarrativeEventEntry[]>(join(entitiesDir, 'events.json'))) ?? [],
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
    const descriptions = await readJsonSafe<FusedDescriptionEntry[]>(
      join(entitiesDir, `${prefix}-descriptions.json`),
    );
    const visuals = await readJsonSafe<VisualDescriptionEntry[]>(
      join(entitiesDir, `${prefix}-visual-descriptions.json`),
    );
    const prompts = await readJsonSafe<GenerationPromptEntry[]>(
      join(entitiesDir, `${prefix}-prompts.json`),
    );

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
