/**
 * 资产快照收集器（B4a）。
 *
 * 把一本书当前冻结的全部稳定产物写入对象存储（去重）+ AssetObject/SnapshotObject，
 * 组装成不可变 manifest，最后把快照状态从 building 翻到 ready。
 *
 * 设计要点：
 *  - 对象内容寻址 + AssetObjectRepository.putIfAbsent 跨书籍去重；
 *  - 同一 snapshotId 重复调用安全（已 ready 直接返回；building 重试清理旧 items）；
 *  - 所有 logicalPath 经 assertSafeManifestPath；
 *  - 缺失的可选产物以三态（present/empty/not-generated）+ 中文原因记录到 manifest 类别，
 *    但不强行写入占位对象。
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  AssetObjectRepository,
  AssetSnapshotRepository,
  SnapshotObjectRepository,
  CharacterRepository,
  LocationRepository,
  ItemRepository,
  WorldviewRepository,
  ReviewRepository,
  NoiseOverrideRepository,
  EntityImageRepository,
  getSharedObjectStore,
  getSharedAssetSourceResolver,
} from '@qunxiang/storage';
import { parseChapterOutline, getChapterCleanedContent } from '@qunxiang/import';
import {
  buildManifest,
  assertSafeManifestPath,
  type ManifestFile,
  type ManifestAssetCategory,
} from '../lib/manifest.js';
import type { SnapshotObjectCategory, SnapshotObjectState } from '@qunxiang/core';
import { stableStringify } from '../lib/stable-json.js';
import { discoverCurrentRun } from './run-discovery.js';

const OUTPUT_ROOT = 'output';

const EXTRACTION_ENTITY_FILES = [
  'character-descriptions.json',
  'item-descriptions.json',
  'location-descriptions.json',
  'character-visual-descriptions.json',
  'item-visual-descriptions.json',
  'location-visual-descriptions.json',
  'character-prompts.json',
  'item-prompts.json',
  'location-prompts.json',
  'characters.json',
  'items.json',
  'locations.json',
  'events.json',
];

const PRESCAN_FILES = ['character.txt', 'location.txt', 'item.txt', 'event.txt', 'importance.txt'];

const CATEGORY_ORDER: ReadonlyArray<string> = [
  'source',
  'entity',
  'review',
  'chapter',
  'noise',
  'extraction',
  'story',
  'image',
];

export interface CollectSnapshotBook {
  id: string;
  title: string;
  filePath?: string | null;
  sourceObjectKey?: string | null;
  updatedAt?: Date | string;
}

export interface CollectSnapshotInput {
  book: CollectSnapshotBook;
  ownerId: string;
  snapshotId: string;
  /** 当前时间（测试可注入）。manifest 不使用此值，只用快照 createdAt。 */
  now?: Date;
}

export interface CollectSnapshotResult {
  manifestObjectId: string;
}

interface PendingFile {
  logicalPath: string;
  body: Buffer;
  mime: string;
  category: SnapshotObjectCategory;
  state: SnapshotObjectState;
  reason?: string;
}

interface WrittenFile {
  objectId: string;
  manifestFile: ManifestFile;
  state: SnapshotObjectState;
  reason?: string;
}

/** 把任意字符串变成 ZIP 安全的路径段。 */
function sanitizeSegment(name: string, fallback = 'untitled'): string {
  const cleaned = String(name ?? '')
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_\s]+|[_\s]+$/g, '');
  let result = cleaned || fallback;
  if (result.length > 80) result = result.slice(0, 80);
  return result;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const st = await stat(path);
    return st.isFile();
  } catch {
    return false;
  }
}

async function readOptionalBuffer(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path);
  } catch {
    return null;
  }
}

/** 写入一个产物到对象存储 + AssetObject，返回对象 id、清单条目和状态。 */
async function putArtifact(file: PendingFile): Promise<WrittenFile> {
  assertSafeManifestPath(file.logicalPath);
  const objectStore = getSharedObjectStore();
  const stored = await objectStore.put({ body: file.body, mime: file.mime });
  const asset = await AssetObjectRepository.putIfAbsent({
    sha256: stored.sha256,
    bytes: stored.bytes,
    mime: file.mime,
    objectKey: stored.objectKey,
    etag: stored.etag,
  });
  return {
    objectId: asset.id,
    manifestFile: {
      logicalPath: file.logicalPath,
      bytes: Number(asset.bytes),
      mime: asset.mime,
      etag: asset.etag ?? undefined,
      sha256: asset.sha256,
    },
    state: file.state,
    reason: file.reason,
  };
}

/** 递归扫描目录：对每个真实存在的文件调用 onFile(absolutePath, relativePath)。 */
async function walkFiles(
  rootPath: string,
  onFile: (absPath: string, relPath: string) => Promise<void>,
): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(rootPath);
  } catch {
    return;
  }
  for (const entry of entries) {
    const abs = join(rootPath, entry);
    const buf = await readOptionalBuffer(abs);
    if (buf !== null) {
      await onFile(abs, entry);
      continue;
    }
    // 不是文件就当作子目录递归（readFile 失败但 readdir 可能成功）
    await walkFiles(abs, async (p, rel) => onFile(p, `${entry}/${rel}`));
  }
}

function toIso(date: Date | string | undefined): string {
  if (!date) return new Date(0).toISOString();
  if (date instanceof Date) return date.toISOString();
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? new Date(0).toISOString() : parsed.toISOString();
}

export async function collectSnapshot(input: CollectSnapshotInput): Promise<CollectSnapshotResult> {
  const { book, ownerId, snapshotId } = input;

  const snapshot = await AssetSnapshotRepository.findOwnedById(snapshotId, ownerId);
  if (!snapshot) throw new Error('快照不存在或无权访问');

  // 幂等：已 ready 的快照直接复用
  if (snapshot.status === 'ready' && snapshot.manifestObjectId) {
    return { manifestObjectId: snapshot.manifestObjectId };
  }
  if (snapshot.status !== 'building') {
    throw new Error(`快照当前状态不允许收集：${snapshot.status}`);
  }

  // 必选：先校验原始内容来源（早失败，避免任何副作用）
  let sourceBuffer: Buffer;
  try {
    sourceBuffer = await getSharedAssetSourceResolver().readSourceBuffer(book);
  } catch {
    throw new Error('书籍没有可读的原始内容来源');
  }

  // 清理可能的部分写入（worker 崩溃后重试）
  await SnapshotObjectRepository.deleteForSnapshot(snapshotId);

  const items: CreateSnapshotObjectItemWithState[] = [];
  const manifestFiles: ManifestFile[] = [];
  const categoryState = new Map<string, { state: 'present' | 'empty' | 'not-generated'; reason?: string }>();

  const STATE_RANK: Record<string, number> = { 'not-generated': 0, empty: 1, present: 2 };
  function setCategory(category: string, state: 'present' | 'empty' | 'not-generated', reason?: string) {
    const existing = categoryState.get(category);
    if (!existing || STATE_RANK[state] > STATE_RANK[existing.state]) {
      categoryState.set(category, { state, reason });
    }
  }

  async function write(file: PendingFile): Promise<WrittenFile> {
    const written = await putArtifact(file);
    items.push({
      objectId: written.objectId,
      logicalPath: file.logicalPath,
      category: file.category,
      state: written.state,
      reason: file.reason,
    });
    manifestFiles.push(written.manifestFile);
    setCategory(file.category, written.state, file.reason);
    return written;
  }

  // ===== source（必选，已预读取）=====
  await write({
    logicalPath: 'source/原始书籍.txt',
    body: sourceBuffer,
    mime: 'text/plain',
    category: 'source',
    state: 'present',
  });

  // ===== entity（DB 权威）=====
  const [characters, locations, itemsList, worldviews] = await Promise.all([
    CharacterRepository.findByBookId(book.id),
    LocationRepository.findByBookId(book.id),
    ItemRepository.findByBookId(book.id),
    WorldviewRepository.findByBookId(book.id),
  ]);
  const entityBuckets = [
    { type: 'characters', data: characters },
    { type: 'locations', data: locations },
    { type: 'items', data: itemsList },
    { type: 'worldviews', data: worldviews },
  ];
  for (const bucket of entityBuckets) {
    const list = bucket.data ?? [];
    const isEmpty = list.length === 0;
    await write({
      logicalPath: `entities/${bucket.type}.json`,
      body: Buffer.from(stableStringify(list), 'utf-8'),
      mime: 'application/json',
      category: 'entity',
      state: isEmpty ? 'empty' : 'present',
      reason: isEmpty ? '尚无该类实体' : undefined,
    });
  }

  // ===== review（DB 聚合）=====
  const reviewBuckets = await Promise.all(
    (characters ?? []).map(async (c) => ({
      characterId: (c as { id: string }).id,
      reviews: await ReviewRepository.findByCharacterId((c as { id: string }).id),
    })),
  );
  const allReviews = reviewBuckets.flatMap((r) => r.reviews);
  const reviewState = allReviews.length === 0 ? 'empty' : 'present';
  const reviewReason = reviewState === 'empty' ? '尚无审核记录' : undefined;
  await write({
    logicalPath: 'reviews/current.json',
    body: Buffer.from(
      stableStringify(reviewBuckets.map((r) => ({ characterId: r.characterId, latest: r.reviews[0] ?? null }))),
      'utf-8',
    ),
    mime: 'application/json',
    category: 'review',
    state: reviewState,
    reason: reviewReason,
  });
  await write({
    logicalPath: 'reviews/history.json',
    body: Buffer.from(stableStringify(allReviews), 'utf-8'),
    mime: 'application/json',
    category: 'review',
    state: reviewState,
    reason: reviewReason,
  });

  // ===== chapter（实时解析原文）=====
  const keepLines = await NoiseOverrideRepository.listKeepLineNums(book.id);
  try {
    const sourceText = sourceBuffer.toString('utf-8');
    const outline = parseChapterOutline(sourceText, book.title, keepLines);
    await write({
      logicalPath: 'chapters/outline.json',
      body: Buffer.from(stableStringify(outline), 'utf-8'),
      mime: 'application/json',
      category: 'chapter',
      state: outline.chapters.length === 0 ? 'empty' : 'present',
      reason: outline.chapters.length === 0 ? '尚未识别到章节' : undefined,
    });
    for (const ch of outline.chapters) {
      const content = getChapterCleanedContent(sourceText, book.title, ch.index, keepLines);
      if (!content) continue;
      const safeTitle = sanitizeSegment(ch.title ?? '', `chapter-${ch.index}`);
      await write({
        logicalPath: `chapters/cleaned/${ch.index}-${safeTitle}.txt`,
        body: Buffer.from(content.content ?? '', 'utf-8'),
        mime: 'text/plain',
        category: 'chapter',
        state: 'present',
      });
    }
  } catch {
    setCategory('chapter', 'empty', '章节解析失败');
  }

  // ===== noise（DB 覆盖）=====
  const keepLineArr = [...keepLines].sort((a, b) => a - b);
  const noiseIsEmpty = keepLineArr.length === 0;
  await write({
    logicalPath: 'noise/overrides.json',
    body: Buffer.from(stableStringify({ keepLines: keepLineArr }), 'utf-8'),
    mime: 'application/json',
    category: 'noise',
    state: noiseIsEmpty ? 'empty' : 'present',
    reason: noiseIsEmpty ? '尚无人工找回行' : undefined,
  });

  // ===== extraction（最新一次官方运行）=====
  const run = await discoverCurrentRun(OUTPUT_ROOT, book.id);
  if (!run) {
    setCategory('extraction', 'not-generated', '书籍尚未提取，无法准备完整下载');
  } else {
    let anyExtraction = false;
    const summaryBuf = await readOptionalBuffer(join(OUTPUT_ROOT, run.runDir, 'final', 'run-summary.json'));
    if (summaryBuf) {
      await write({
        logicalPath: 'extraction/latest/run-summary.json',
        body: summaryBuf,
        mime: 'application/json',
        category: 'extraction',
        state: 'present',
      });
      anyExtraction = true;
    }
    for (const f of EXTRACTION_ENTITY_FILES) {
      const buf = await readOptionalBuffer(join(OUTPUT_ROOT, run.runDir, 'entities', f));
      if (buf) {
        await write({
          logicalPath: `extraction/latest/entities/${f}`,
          body: buf,
          mime: 'application/json',
          category: 'extraction',
          state: 'present',
        });
        anyExtraction = true;
      }
    }
    for (const f of PRESCAN_FILES) {
      const buf = await readOptionalBuffer(join('.intermediate', run.runDir, 'prescan', f));
      if (buf) {
        await write({
          logicalPath: `extraction/latest/prescan/${f}`,
          body: buf,
          mime: 'text/plain',
          category: 'extraction',
          state: 'present',
        });
        anyExtraction = true;
      }
    }
    if (!anyExtraction) {
      setCategory('extraction', 'not-generated', '提取产物尚未就绪');
    }
  }

  // ===== image（DB + 对象存储 / 文件回退）=====
  const imageRows = await EntityImageRepository.findByBookId(book.id);
  const objectStore = getSharedObjectStore();
  const indexEntries: Array<Record<string, unknown>> = [];
  for (const img of imageRows) {
    let imgBuf: Buffer | null = null;
    if (img.objectKey) {
      try {
        imgBuf = Buffer.from((await objectStore.get(img.objectKey)).bytes);
      } catch {
        imgBuf = null;
      }
    } else if (img.filePath) {
      imgBuf = await readOptionalBuffer(img.filePath);
    }
    if (!imgBuf) continue;
    const safeEntity = sanitizeSegment(`${img.entityType}-${img.entityName}`, 'entity');
    const fileName = `${safeEntity}-${String(img.id).slice(0, 8)}.${img.ext || 'bin'}`;
    const written = await write({
      logicalPath: `images/files/${fileName}`,
      body: imgBuf,
      mime: img.mime || 'application/octet-stream',
      category: 'image',
      state: 'present',
    });
    indexEntries.push({
      entityType: img.entityType,
      entityName: img.entityName,
      isPrimary: img.isPrimary,
      mime: img.mime,
      ext: img.ext,
      path: `images/files/${fileName}`,
      bytes: written.manifestFile.bytes,
      sha256: written.manifestFile.sha256,
    });
  }
  await write({
    logicalPath: 'images/index.json',
    body: Buffer.from(stableStringify(indexEntries), 'utf-8'),
    mime: 'application/json',
    category: 'image',
    state: imageRows.length === 0 ? 'empty' : 'present',
    reason: imageRows.length === 0 ? '尚无实体图片' : undefined,
  });

  // ===== story（条件：output/{bookId}/story-segments.json 存在）=====
  const segmentsExists = await fileExists(join(OUTPUT_ROOT, book.id, 'story-segments.json'));
  if (!segmentsExists) {
    setCategory('story', 'not-generated', '未执行故事分割');
  } else {
    let anyStory = false;
    for (const f of ['story-segments.json', 'story-boundary-review.json', 'director-assignments.json']) {
      const buf = await readOptionalBuffer(join(OUTPUT_ROOT, book.id, f));
      if (buf) {
        await write({
          logicalPath: `stories/${f}`,
          body: buf,
          mime: 'application/json',
          category: 'story',
          state: 'present',
        });
        anyStory = true;
      }
    }
    await walkFiles(join(OUTPUT_ROOT, book.id, 'stories'), async (abs, rel) => {
      if (!rel.endsWith('.json')) return;
      const buf = await readOptionalBuffer(abs);
      if (!buf) return;
      await write({
        logicalPath: `stories/${rel}`,
        body: buf,
        mime: 'application/json',
        category: 'story',
        state: 'present',
      });
      anyStory = true;
    });
    if (!anyStory) setCategory('story', 'not-generated', '故事产物尚未就绪');
  }

  // ===== 组装并写入 manifest =====
  const generatedAt = toIso(snapshot.createdAt as unknown as Date | string);
  const categories: ManifestAssetCategory[] = CATEGORY_ORDER.filter((c) => categoryState.has(c)).map((c) => {
    const v = categoryState.get(c)!;
    return { category: c, state: v.state, reason: v.reason };
  });

  const manifest = buildManifest({
    bookId: book.id,
    snapshotId,
    generatedAt,
    sourceType: 'novel',
    categories,
    files: manifestFiles,
  });
  const manifestBody = Buffer.from(stableStringify(manifest), 'utf-8');
  const manifestWritten = await putArtifact({
    logicalPath: 'manifest.json',
    body: manifestBody,
    mime: 'application/json',
    category: 'manifest',
    state: 'present',
  });
  items.push({
    objectId: manifestWritten.objectId,
    logicalPath: 'manifest.json',
    category: 'manifest',
    state: 'present',
  });

  await SnapshotObjectRepository.bulkCreate(snapshotId, items);
  await AssetSnapshotRepository.markReady(snapshotId, manifestWritten.objectId);

  return { manifestObjectId: manifestWritten.objectId };
}

// 局部类型，避免上层导入 CreateSnapshotObjectItem 与本文件状态字段冲突
interface CreateSnapshotObjectItemWithState {
  objectId: string;
  logicalPath: string;
  category: SnapshotObjectCategory;
  state: SnapshotObjectState;
  reason?: string;
}
