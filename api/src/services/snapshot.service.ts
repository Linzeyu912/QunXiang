/**
 * 资产快照编排服务（B4b）。
 *
 * 职责：计算成果版本、按需创建/复用快照、查询下载状态、返回脱敏摘要、签发短时下载授权。
 * 实际收集/打包由后台 worker（job-worker.service）异步完成；本服务只做 DB 编排与签名。
 *
 * 安全：所有者隔离（不属于当前账号一律返回 null/中文错误）；签名 URL 不入库不入日志；
 * 对象键不进入前端响应；ETag/bytes 来自对象存储元数据。
 */
import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  AssetSnapshotRepository,
  AssetObjectRepository,
  BackgroundJobRepository,
  CharacterRepository,
  LocationRepository,
  ItemRepository,
  NoiseOverrideRepository,
  getSharedObjectStore,
} from '@qunxiang/storage';
import type { ContentRevisionInput } from '../lib/content-revision.js';
import { computeContentRevision } from '../lib/content-revision.js';
import { stableStringify } from '../lib/stable-json.js';
import { discoverCurrentRun } from '../snapshot/run-discovery.js';

const OUTPUT_ROOT = 'output';

export interface SnapshotServiceBook {
  id: string;
  title: string;
  updatedAt?: Date | string;
}

function sha256OfString(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const st = await stat(path);
    return st.isFile();
  } catch {
    return false;
  }
}

/** 计算一本书当前的 contentRevision 输入与最终 revision。 */
export async function buildContentRevisionInputs(book: SnapshotServiceBook): Promise<{
  input: ContentRevisionInput;
  contentRevision: string;
}> {
  const [run, characters, locations, items, keepLines, segmentsExists] = await Promise.all([
    discoverCurrentRun(OUTPUT_ROOT, book.id),
    CharacterRepository.findByBookId(book.id),
    LocationRepository.findByBookId(book.id),
    ItemRepository.findByBookId(book.id),
    NoiseOverrideRepository.listKeepLineNums(book.id),
    fileExists(join(OUTPUT_ROOT, book.id, 'story-segments.json')),
  ]);

  const entityHashes = {
    characters: sha256OfString(stableStringify(characters ?? [])),
    locations: sha256OfString(stableStringify(locations ?? [])),
    items: sha256OfString(stableStringify(items ?? [])),
  };
  const noiseOverrideHash = sha256OfString(stableStringify([...keepLines].sort((a, b) => a - b)));
  const storyHash = segmentsExists ? 'story-segments' : 'none';

  const input: ContentRevisionInput = {
    bookUpdatedAt: book.updatedAt instanceof Date ? book.updatedAt.toISOString() : (book.updatedAt ?? new Date(0).toISOString()),
    run,
    entityHashes,
    noiseOverrideHash,
    storyHash,
  };
  return { input, contentRevision: computeContentRevision(input) };
}

export interface PrepareSnapshotResult {
  snapshotId: string;
  state: 'preparing' | 'ready' | 'failed';
}

/** 按需创建或复用快照，并投递 asset-snapshot 后台任务。 */
export async function prepareSnapshot(book: SnapshotServiceBook, ownerId: string, now: Date = new Date()): Promise<PrepareSnapshotResult> {
  const { contentRevision } = await buildContentRevisionInputs(book);

  // 复用同成果的非失败快照（不重复建、不重复入队）
  const existing = await AssetSnapshotRepository.findByBookAndContentRevision(book.id, contentRevision);
  if (existing) {
    if (existing.status === 'failed') {
      // 失败快照清除后重建，避免 contentRevision 唯一约束把同成果版本卡死（P0-2）
      await AssetSnapshotRepository.deleteById(existing.id);
    } else {
      const state: PrepareSnapshotResult['state'] = existing.status === 'ready' ? 'ready' : 'preparing';
      return { snapshotId: existing.id, state };
    }
  }

  try {
    const snapshot = await AssetSnapshotRepository.create({
      bookId: book.id,
      ownerId,
      contentRevision,
      now,
    });

    await BackgroundJobRepository.enqueue({
      kind: 'asset-snapshot',
      uniqueKey: `${book.id}:${contentRevision}:asset-snapshot`,
      payload: { snapshotId: snapshot.id, bookId: book.id, ownerId },
      now,
    });

    return { snapshotId: snapshot.id, state: 'preparing' };
  } catch (err) {
    // 并发竞态：另一请求刚建同 contentRevision 快照（双击等），复用之（P1-7）
    const msg = err instanceof Error ? err.message : String(err);
    if (/已存在快照/.test(msg)) {
      const concurrent = await AssetSnapshotRepository.findByBookAndContentRevision(book.id, contentRevision);
      if (concurrent && concurrent.status !== 'failed') {
        const state: PrepareSnapshotResult['state'] = concurrent.status === 'ready' ? 'ready' : 'preparing';
        return { snapshotId: concurrent.id, state };
      }
    }
    throw err;
  }
}

export type DownloadState =
  | 'not-prepared'
  | 'preparing'
  | 'ready'
  | 'needs-update'
  | 'failed';

export interface DownloadStateResponse {
  state: DownloadState;
  snapshotId?: string;
  snapshotVersion?: number;
  readyAt?: string;
  bytes?: number;
  failureReason?: string;
}

/** 当前下载状态（前端轮询用）。 */
export async function getDownloadState(book: SnapshotServiceBook, ownerId: string): Promise<DownloadStateResponse> {
  const snapshot = await AssetSnapshotRepository.findCurrentForBook(book.id, ownerId);
  if (!snapshot) return { state: 'not-prepared' };

  if (snapshot.status === 'building') {
    return { state: 'preparing', snapshotId: snapshot.id, snapshotVersion: snapshot.version };
  }
  if (snapshot.status === 'failed') {
    return {
      state: 'failed',
      snapshotId: snapshot.id,
      snapshotVersion: snapshot.version,
      failureReason: snapshot.failureReason ?? '准备失败',
    };
  }
  // ready：与当前成果对比
  const { contentRevision } = await buildContentRevisionInputs(book);
  if (snapshot.contentRevision !== contentRevision) {
    return {
      state: 'needs-update',
      snapshotId: snapshot.id,
      snapshotVersion: snapshot.version,
      readyAt: snapshot.readyAt ? snapshot.readyAt.toISOString() : undefined,
    };
  }
  // archiveObjectId 缺：收集完成但归档未就绪（仍在打包或归档失败）→ preparing，
  // 避免前端拿到 ready 后请求下载授权被 409 拒绝（P1-4）
  if (!snapshot.archiveObjectId) {
    return {
      state: 'preparing',
      snapshotId: snapshot.id,
      snapshotVersion: snapshot.version,
      readyAt: snapshot.readyAt ? snapshot.readyAt.toISOString() : undefined,
    };
  }
  const archive = await AssetObjectRepository.findById(snapshot.archiveObjectId);
  const bytes = archive ? Number(archive.bytes) : undefined;
  return {
    state: 'ready',
    snapshotId: snapshot.id,
    snapshotVersion: snapshot.version,
    readyAt: snapshot.readyAt ? snapshot.readyAt.toISOString() : undefined,
    bytes,
  };
}

export interface SnapshotSummary {
  snapshotId: string;
  version: number;
  status: string;
  contentRevision: string;
  readyAt: string | null;
  bytes: number | null;
  failureReason: string | null;
  fileCount: number | null;
}

/** 脱敏摘要（不含对象键、签名等敏感字段）。 */
export async function getSnapshotSummary(
  book: SnapshotServiceBook,
  snapshotId: string,
  ownerId: string,
): Promise<SnapshotSummary | null> {
  const snapshot = await AssetSnapshotRepository.findOwnedById(snapshotId, ownerId);
  if (!snapshot || snapshot.bookId !== book.id) return null;

  let bytes: number | null = null;
  if (snapshot.archiveObjectId) {
    const archive = await AssetObjectRepository.findById(snapshot.archiveObjectId);
    if (archive) bytes = Number(archive.bytes);
  }

  return {
    snapshotId: snapshot.id,
    version: snapshot.version,
    status: snapshot.status,
    contentRevision: snapshot.contentRevision,
    readyAt: snapshot.readyAt ? snapshot.readyAt.toISOString() : null,
    bytes,
    failureReason: snapshot.failureReason,
    fileCount: null, // 由路由从 SnapshotObjectRepository.count* 补全（保持本服务无 SnapshotObject 依赖）
  };
}

export interface DownloadAuthorization {
  url: string;
  expiresAt: Date;
  etag?: string;
  bytes: number;
}

/** 仅当快照 ready 且 archiveObjectId 已就绪时签发短时下载地址。 */
export async function authorizeDownload(
  book: SnapshotServiceBook,
  snapshotId: string,
  ownerId: string,
): Promise<DownloadAuthorization> {
  const snapshot = await AssetSnapshotRepository.findOwnedById(snapshotId, ownerId);
  if (!snapshot || snapshot.bookId !== book.id) {
    throw new Error('书籍不存在或无权访问');
  }
  if (snapshot.status !== 'ready' || !snapshot.archiveObjectId) {
    throw new Error('完整数据包尚未准备完成');
  }
  const archive = await AssetObjectRepository.findById(snapshot.archiveObjectId);
  if (!archive) {
    throw new Error('完整数据包尚未准备完成');
  }
  const signed = await getSharedObjectStore().createDownloadUrl({
    objectKey: archive.objectKey,
    expiresInSeconds: 600,
  });
  return {
    url: signed.url,
    expiresAt: signed.expiresAt,
    etag: signed.etag,
    bytes: signed.bytes !== undefined ? Number(signed.bytes) : Number(archive.bytes),
  };
}
