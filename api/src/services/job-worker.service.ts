/**
 * 快照收集与打包后台 Worker（B5）。
 *
 * 通过 BackgroundJobRepository 的租约队列消费两种任务：
 *   - asset-snapshot：调用 collectSnapshot 把快照翻到 ready，再入队 snapshot-archive。
 *   - snapshot-archive：按 manifest 重建文件列表，生成确定性 ZIP 并 markArchived。
 *
 * 处理过程中按固定间隔心跳续租；任何异常都转为 fail（中文 reason）。
 * 业务/权限类错误非重试；对象存储/DB 瞬时错标记为 retryable 由 BackgroundJob 自行重试。
 */
import {
  BackgroundJobRepository,
  BookRepository,
  AssetSnapshotRepository,
  SnapshotObjectRepository,
  AssetObjectRepository,
  getSharedObjectStore,
} from '@qunxiang/storage';
import { collectSnapshot } from '../snapshot/collector.js';
import { copyShareToLibrary } from '../snapshot/book-copy.js';
import { createArchiveZip } from '../lib/zip.js';

const DEFAULT_INTERVAL_MS = 1000;
const MAX_IDLE_INTERVAL_MS = 5000;
const DEFAULT_LEASE_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 10_000;
const DEFAULT_WORKER_ID = 'snapshot-worker-1';
const SNAPSHOT_JOB_KINDS = ['asset-snapshot', 'snapshot-archive', 'book-copy', 'entity-enrichment'] as const;

const DOWNLOAD_AUTH_TTL_SECONDS = 600;

/** 非重试错误：权限/状态类问题，重试也无济于事。 */
export class NonRetryableJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonRetryableJobError';
  }
}

function isTransientError(err: unknown): boolean {
  if (err instanceof NonRetryableJobError) return false;
  const msg = err instanceof Error ? err.message : String(err);
  // 数据库繁忙、连接超时、对象存储瞬时不可用视为可重试
  return /繁忙|超时|连接|对象存储|暂时不可用|ECONNRESET|ETIMEDOUT|ENOTFOUND|5\d{2}/i.test(msg);
}

export interface SnapshotWorkerOptions {
  workerId?: string;
  leaseMs?: number;
  heartbeatIntervalMs?: number;
  now?: () => Date;
}

export interface SnapshotWorkerHandle {
  stop(): void;
  /** 处理一条待办任务，返回是否命中。测试可直接调用以驱动单步。 */
  processOnce(): Promise<boolean>;
}

interface SnapshotJobPayload {
  snapshotId: string;
  bookId: string;
  ownerId: string;
}

interface BookCopyJobPayload {
  shareId: string;
  recipientId: string;
}

function nowFn(opts: SnapshotWorkerOptions): () => Date {
  return opts.now ?? (() => new Date());
}

export function startSnapshotWorker(intervalMs: number = DEFAULT_INTERVAL_MS, opts: SnapshotWorkerOptions = {}): SnapshotWorkerHandle {
  const now = nowFn(opts);
  // 启动即回收过期租约
  BackgroundJobRepository.recoverExpired({ now: now() }).catch((err) => {
    console.error('回收过期快照任务失败：', err instanceof Error ? err.message : String(err));
  });

  let isProcessing = false;
  let stopped = false;
  let currentInterval = intervalMs;
  let timer: ReturnType<typeof setTimeout> | null = null;

  // 命中任务后恢复基础间隔；空闲时逐步退避，减少无任务时的数据库轮询。
  function scheduleNext(): void {
    if (stopped) return;
    timer = setTimeout(() => {
      processOnce()
        .then((processed) => {
          currentInterval = processed
            ? intervalMs
            : Math.min(currentInterval * 2, MAX_IDLE_INTERVAL_MS);
        })
        .catch((err) => {
          console.error('快照后台任务异常：', err instanceof Error ? err.message : String(err));
        })
        .finally(scheduleNext);
    }, currentInterval);
    if (typeof (timer as unknown as { unref?: () => void }).unref === 'function') {
      (timer as unknown as { unref: () => void }).unref();
    }
  }
  scheduleNext();
  // 周期回收过期租约，避免心跳失败时任务卡在 running 直到进程重启（P1-5）
  const recoveryTimer = setInterval(() => {
    BackgroundJobRepository.recoverExpired({ now: now() }).catch(() => {});
  }, 30_000);
  if (typeof (recoveryTimer as unknown as { unref?: () => void }).unref === 'function') {
    (recoveryTimer as unknown as { unref: () => void }).unref();
  }

  async function processOnce(): Promise<boolean> {
    if (isProcessing || stopped) return false;
    isProcessing = true;
    const workerId = opts.workerId ?? DEFAULT_WORKER_ID;
    const leaseMs = opts.leaseMs ?? DEFAULT_LEASE_MS;
    try {
      const job = await BackgroundJobRepository.claimNext({
        workerId,
        kinds: [...SNAPSHOT_JOB_KINDS],
        leaseMs,
        now: now(),
      });
      if (!job) return false;

      // 心跳续租
      const heartbeatTimer = setInterval(() => {
        BackgroundJobRepository.heartbeat({
          jobId: job.id,
          workerId,
          leaseMs,
          now: now(),
        }).catch(() => {});
      }, opts.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS);
      if (typeof (heartbeatTimer as unknown as { unref?: () => void }).unref === 'function') {
        (heartbeatTimer as unknown as { unref: () => void }).unref();
      }

      try {
        await dispatchSnapshotJob(job.kind, job.payload ?? {}, opts);
        await BackgroundJobRepository.complete({
          jobId: job.id,
          workerId,
          result: { ok: true },
          now: now(),
        });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        const retryable = isTransientError(err);
        await BackgroundJobRepository.fail({
          jobId: job.id,
          workerId,
          reason,
          retryable,
          now: now(),
        });
      } finally {
        clearInterval(heartbeatTimer);
      }
      return true;
    } finally {
      isProcessing = false;
    }
  }

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      clearInterval(recoveryTimer);
    },
    processOnce,
  };
}

async function dispatchSnapshotJob(kind: string, payload: unknown, opts: SnapshotWorkerOptions): Promise<void> {
  if (kind === 'asset-snapshot') {
    return processAssetSnapshotJob(payload as SnapshotJobPayload, opts);
  }
  if (kind === 'snapshot-archive') {
    return processSnapshotArchiveJob(payload as SnapshotJobPayload, opts);
  }
  if (kind === 'book-copy') {
    return processBookCopyJob((payload as BookCopyJobPayload) ?? ({} as BookCopyJobPayload), opts);
  }
  if (kind === 'entity-enrichment') {
    const { processEntityEnrichmentJob } = await import('./entity-enrichment.service.js');
    await processEntityEnrichmentJob((payload ?? {}) as Parameters<typeof processEntityEnrichmentJob>[0]);
  }
  throw new NonRetryableJobError(`未知的快照任务类型：${kind}`);
}

async function processAssetSnapshotJob(payload: SnapshotJobPayload, opts: SnapshotWorkerOptions): Promise<void> {
  const { bookId, ownerId, snapshotId } = payload;
  const book = await BookRepository.findOwnedById(bookId, ownerId);
  if (!book) throw new NonRetryableJobError('书籍不存在或无权访问');

  const snapshot = await AssetSnapshotRepository.findOwnedById(snapshotId, ownerId);
  if (!snapshot) throw new NonRetryableJobError('快照不属于该账号');

  await collectSnapshot({ book, ownerId, snapshotId });
  // 收集完成（collectSnapshot 已 markReady）后，把该快照置为书库当前快照，
  // 供 getDownloadState / 签名下载定位。失败快照不会走到这里（collectSnapshot 抛会被 fail 捕获）。
  await BookRepository.setCurrentSnapshot(bookId, snapshotId);

  await BackgroundJobRepository.enqueue({
    kind: 'snapshot-archive',
    uniqueKey: `${snapshotId}:snapshot-archive`,
    payload: { snapshotId, bookId, ownerId },
    // 归档可能因瞬时错误失败到 failed；重新收集后重置为 pending 重投（P1-8）
    reactivate: true,
    now: nowFn(opts)(),
  });
}

async function processSnapshotArchiveJob(payload: SnapshotJobPayload, _opts: SnapshotWorkerOptions): Promise<void> {
  const { snapshotId, ownerId } = payload;
  const snapshot = await AssetSnapshotRepository.findOwnedById(snapshotId, ownerId);
  if (!snapshot) throw new NonRetryableJobError('快照不属于该账号');
  if (snapshot.status !== 'ready') {
    throw new NonRetryableJobError('快照尚未完成收集，无法打包');
  }
  if (snapshot.archiveObjectId) {
    // 幂等：已打包
    return;
  }

  const items = await SnapshotObjectRepository.listForSnapshot(snapshotId);
  const objectStore = getSharedObjectStore();
  const entries: Array<{ logicalPath: string; body: Uint8Array }> = [];
  for (const item of items) {
    const obj = await AssetObjectRepository.findById(item.objectId);
    if (!obj) continue; // 对象被回收则跳过（不应发生在 ready 快照上）
    const body = await objectStore.get(obj.objectKey);
    entries.push({ logicalPath: item.logicalPath, body: Buffer.from(body.bytes) });
  }

  const zipBuffer = await createArchiveZip(entries);
  const stored = await objectStore.put({ body: zipBuffer, mime: 'application/zip' });
  const asset = await AssetObjectRepository.putIfAbsent({
    sha256: stored.sha256,
    bytes: stored.bytes,
    mime: 'application/zip',
    objectKey: stored.objectKey,
    etag: stored.etag,
  });
  await AssetSnapshotRepository.markArchived(snapshotId, asset.id);
}

async function processBookCopyJob(payload: BookCopyJobPayload, opts: SnapshotWorkerOptions): Promise<void> {
  const { shareId, recipientId } = payload;
  if (!shareId || !recipientId) {
    throw new NonRetryableJobError('复制任务缺少必要参数');
  }
  // copyShareToLibrary 内部：撤销竞态/已 copied 幂等返回；状态/参数错抛中文 NonRetryable；
  // DB 瞬时错原样抛出，由上层 isTransientError 判定 retryable。
  await copyShareToLibrary({ shareId, recipientId, now: nowFn(opts)() });
}

// 防止未使用常量被精简
void DOWNLOAD_AUTH_TTL_SECONDS;
