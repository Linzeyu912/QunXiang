import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

const mockState = vi.hoisted(() => {
  return {
    nextJob: null as any | null,
    claimed: [] as any[],
    completed: [] as any[],
    failed: [] as any[],
    heartbeats: [] as any[],
    enqueued: [] as any[],
    recovered: false,
    books: new Map<string, any>(),
    snapshots: new Map<string, any>(),
    snapshotObjects: new Map<string, any[]>(),
    assetObjects: new Map<string, any>(),
    collectedSnapshots: [] as any[],
    collectSnapshotError: null as Error | null,
    objectStoreGetError: null as Error | null,
    objectStorePutError: null as Error | null,
    createdZip: null as { entries: any[] } | null,
    reset() {
      this.nextJob = null;
      this.claimed.length = 0;
      this.completed.length = 0;
      this.failed.length = 0;
      this.heartbeats.length = 0;
      this.enqueued.length = 0;
      this.recovered = false;
      this.books.clear();
      this.snapshots.clear();
      this.snapshotObjects.clear();
      this.assetObjects.clear();
      this.collectedSnapshots.length = 0;
      this.collectSnapshotError = null;
      this.objectStoreGetError = null;
      this.objectStorePutError = null;
      this.createdZip = null;
    },
  };
});

vi.mock('@qunxiang/storage', () => ({
  BackgroundJobRepository: {
    async enqueue(input: any) {
      mockState.enqueued.push(input);
      return { id: randomUUID(), ...input };
    },
    async claimNext() {
      const job = mockState.nextJob;
      if (job) mockState.claimed.push(job);
      mockState.nextJob = null;
      return job;
    },
    async heartbeat(input: any) {
      mockState.heartbeats.push(input);
      return null;
    },
    async complete(input: any) {
      mockState.completed.push(input);
      return null;
    },
    async fail(input: any) {
      mockState.failed.push(input);
      return null;
    },
    async recoverExpired() {
      mockState.recovered = true;
      return [];
    },
  },
  BookRepository: {
    async findOwnedById(id: string, ownerId: string) {
      const b = mockState.books.get(id);
      if (!b || b.userId !== ownerId) return null;
      return b;
    },
    async setCurrentSnapshot(id: string, snapshotId: string | null) {
      const b = mockState.books.get(id);
      if (b) b.currentSnapshotId = snapshotId;
    },
  },
  AssetSnapshotRepository: {
    async findOwnedById(id: string, ownerId: string) {
      const s = mockState.snapshots.get(id);
      if (!s || s.ownerId !== ownerId) return null;
      return { ...s };
    },
    async markArchived(id: string, archiveObjectId: string) {
      const s = mockState.snapshots.get(id);
      if (!s) return null;
      s.archiveObjectId = archiveObjectId;
      return { ...s };
    },
  },
  SnapshotObjectRepository: {
    async listForSnapshot(snapshotId: string) {
      return [...(mockState.snapshotObjects.get(snapshotId) ?? [])];
    },
  },
  AssetObjectRepository: {
    async putIfAbsent(input: any) {
      const id = input.objectKey;
      mockState.assetObjects.set(id, { id, ...input });
      return mockState.assetObjects.get(id);
    },
    async findById(id: string) {
      return mockState.assetObjects.get(id) ?? null;
    },
  },
  getSharedObjectStore: () => ({
    async put(input: any) {
      if (mockState.objectStorePutError) throw mockState.objectStorePutError;
      const sha = randomUUID().replace(/-/g, '').slice(0, 64);
      const objectKey = `obj/${sha.slice(0, 2)}/${sha.slice(2, 4)}/${sha}`;
      return {
        objectKey,
        sha256: sha,
        bytes: BigInt(input.body.byteLength),
        mime: input.mime,
        etag: sha,
      };
    },
    async get(objectKey: string) {
      if (mockState.objectStoreGetError) throw mockState.objectStoreGetError;
      const obj = [...mockState.assetObjects.values()].find((o) => o.objectKey === objectKey);
      if (!obj) throw new Error('对象不存在');
      const body = (obj as any)._body ?? Buffer.from('content');
      return { bytes: body };
    },
  }),
}));

vi.mock('../snapshot/collector.js', () => ({
  collectSnapshot: vi.fn(async (input: any) => {
    if (mockState.collectSnapshotError) throw mockState.collectSnapshotError;
    mockState.collectedSnapshots.push(input);
    return { manifestObjectId: randomUUID() };
  }),
}));

vi.mock('../lib/zip.js', () => ({
  createArchiveZip: vi.fn(async (entries: any[]) => {
    mockState.createdZip = { entries };
    return Buffer.from(`zip-${entries.length}`);
  }),
}));

import { startSnapshotWorker } from './job-worker.service.js';
import { collectSnapshot } from '../snapshot/collector.js';
import { createArchiveZip } from '../lib/zip.js';

const BOOK_ID = '00000000-0000-4000-8000-000000000001';
const OWNER_ID = '00000000-0000-4000-8000-000000000002';
const SNAPSHOT_ID = '00000000-0000-4000-8000-000000000003';
const OTHER_OWNER = '00000000-0000-4000-8000-000000000004';

function seedBook(): void {
  mockState.books.set(BOOK_ID, { id: BOOK_ID, title: '测试书', userId: OWNER_ID });
}

function seedBuildingSnapshot(): void {
  mockState.snapshots.set(SNAPSHOT_ID, {
    id: SNAPSHOT_ID,
    bookId: BOOK_ID,
    ownerId: OWNER_ID,
    status: 'building',
    contentRevision: 'rev-1',
    archiveObjectId: null,
    manifestObjectId: null,
  });
}

function seedReadySnapshot(): void {
  mockState.snapshots.set(SNAPSHOT_ID, {
    id: SNAPSHOT_ID,
    bookId: BOOK_ID,
    ownerId: OWNER_ID,
    status: 'ready',
    contentRevision: 'rev-1',
    archiveObjectId: null,
    manifestObjectId: randomUUID(),
  });
}

describe('startSnapshotWorker', () => {
  beforeEach(() => {
    mockState.reset();
    vi.clearAllMocks();
  });
  afterEach(() => {});

  it('启动时调用 recoverExpired', async () => {
    const worker = startSnapshotWorker(60_000);
    // recoverExpired 异步触发，等一个微任务
    await new Promise((r) => setTimeout(r, 5));
    expect(mockState.recovered).toBe(true);
    worker.stop();
  });

  it('无任务时 processOnce 返回 false', async () => {
    const worker = startSnapshotWorker(60_000);
    const hit = await worker.processOnce();
    expect(hit).toBe(false);
    worker.stop();
  });
});

describe('asset-snapshot 任务', () => {
  beforeEach(() => {
    mockState.reset();
    vi.clearAllMocks();
  });

  it('成功：调用 collectSnapshot、入队 snapshot-archive、complete', async () => {
    seedBook();
    seedBuildingSnapshot();
    mockState.nextJob = {
      id: 'job-1',
      kind: 'asset-snapshot',
      uniqueKey: `${BOOK_ID}:rev-1:asset-snapshot`,
      payload: { snapshotId: SNAPSHOT_ID, bookId: BOOK_ID, ownerId: OWNER_ID },
    };
    const worker = startSnapshotWorker(60_000);
    const hit = await worker.processOnce();
    worker.stop();

    expect(hit).toBe(true);
    expect(mockState.collectedSnapshots).toHaveLength(1);
    expect(mockState.collectedSnapshots[0].snapshotId).toBe(SNAPSHOT_ID);
    const archiveEnq = mockState.enqueued.find((e) => e.kind === 'snapshot-archive');
    expect(archiveEnq).toBeDefined();
    expect(archiveEnq.uniqueKey).toBe(`${SNAPSHOT_ID}:snapshot-archive`);
    expect(mockState.completed).toHaveLength(1);
    expect(mockState.completed[0].jobId).toBe('job-1');
    expect(mockState.books.get(BOOK_ID)?.currentSnapshotId).toBe(SNAPSHOT_ID);
    expect(mockState.failed).toEqual([]);
  });

  it('书籍不属于该账号：非重试 fail 且中文 reason', async () => {
    seedBuildingSnapshot();
    mockState.nextJob = {
      id: 'job-2',
      kind: 'asset-snapshot',
      uniqueKey: 'k2',
      payload: { snapshotId: SNAPSHOT_ID, bookId: BOOK_ID, ownerId: OWNER_ID },
    };
    const worker = startSnapshotWorker(60_000);
    await worker.processOnce();
    worker.stop();

    expect(mockState.failed).toHaveLength(1);
    expect(mockState.failed[0].retryable).toBe(false);
    expect(mockState.failed[0].reason).toContain('书籍');
    expect(mockState.completed).toEqual([]);
    expect(mockState.collectedSnapshots).toEqual([]);
  });

  it('快照不属于该账号：非重试 fail 中文 reason', async () => {
    seedBook();
    mockState.snapshots.set(SNAPSHOT_ID, {
      id: SNAPSHOT_ID,
      bookId: BOOK_ID,
      ownerId: OTHER_OWNER,
      status: 'building',
    });
    mockState.nextJob = {
      id: 'job-3',
      kind: 'asset-snapshot',
      uniqueKey: 'k3',
      payload: { snapshotId: SNAPSHOT_ID, bookId: BOOK_ID, ownerId: OWNER_ID },
    };
    const worker = startSnapshotWorker(60_000);
    await worker.processOnce();
    worker.stop();
    expect(mockState.failed).toHaveLength(1);
    expect(mockState.failed[0].retryable).toBe(false);
    expect(mockState.failed[0].reason).toContain('快照');
  });

  it('collectSnapshot 抛瞬时错：retryable=true fail', async () => {
    seedBook();
    seedBuildingSnapshot();
    mockState.collectSnapshotError = new Error('对象存储暂时不可用');
    mockState.nextJob = {
      id: 'job-4',
      kind: 'asset-snapshot',
      uniqueKey: 'k4',
      payload: { snapshotId: SNAPSHOT_ID, bookId: BOOK_ID, ownerId: OWNER_ID },
    };
    const worker = startSnapshotWorker(60_000);
    await worker.processOnce();
    worker.stop();
    expect(mockState.failed).toHaveLength(1);
    expect(mockState.failed[0].retryable).toBe(true);
  });
});

describe('snapshot-archive 任务', () => {
  beforeEach(() => {
    mockState.reset();
    vi.clearAllMocks();
  });

  it('成功：构建 ZIP、写入对象、markArchived、complete', async () => {
    seedBook();
    seedReadySnapshot();
    // 预置两个 SnapshotObject + 对应 AssetObject
    const manifestObjectId = randomUUID();
    const srcObjectId = randomUUID();
    mockState.snapshotObjects.set(SNAPSHOT_ID, [
      { objectId: srcObjectId, logicalPath: 'source/原始书籍.txt', category: 'source', state: 'present' },
      { objectId: manifestObjectId, logicalPath: 'manifest.json', category: 'manifest', state: 'present' },
    ]);
    mockState.assetObjects.set(srcObjectId, {
      id: srcObjectId, objectKey: `obj/source-${srcObjectId}`, sha256: 'a'.repeat(64), bytes: BigInt(5), mime: 'text/plain',
      _body: Buffer.from('hello'),
    });
    mockState.assetObjects.set(manifestObjectId, {
      id: manifestObjectId, objectKey: `obj/manifest-${manifestObjectId}`, sha256: 'b'.repeat(64), bytes: BigInt(3), mime: 'application/json',
      _body: Buffer.from('{}'),
    });

    mockState.nextJob = {
      id: 'job-5',
      kind: 'snapshot-archive',
      uniqueKey: `${SNAPSHOT_ID}:snapshot-archive`,
      payload: { snapshotId: SNAPSHOT_ID, bookId: BOOK_ID, ownerId: OWNER_ID },
    };
    const worker = startSnapshotWorker(60_000);
    const hit = await worker.processOnce();
    worker.stop();

    expect(hit).toBe(true);
    expect(mockState.createdZip).toBeTruthy();
    expect(mockState.createdZip!.entries.map((e) => e.logicalPath).sort()).toEqual([
      'manifest.json',
      'source/原始书籍.txt',
    ]);
    const archived = mockState.snapshots.get(SNAPSHOT_ID);
    expect(archived.archiveObjectId).toBeTruthy();
    expect(mockState.completed).toHaveLength(1);
    expect(collectSnapshot).not.toHaveBeenCalled();
  });

  it('已 archiveObjectId：幂等 no-op + complete', async () => {
    seedBook();
    mockState.snapshots.set(SNAPSHOT_ID, {
      id: SNAPSHOT_ID,
      bookId: BOOK_ID,
      ownerId: OWNER_ID,
      status: 'ready',
      archiveObjectId: randomUUID(),
      manifestObjectId: randomUUID(),
    });
    mockState.nextJob = {
      id: 'job-6',
      kind: 'snapshot-archive',
      uniqueKey: `${SNAPSHOT_ID}:snapshot-archive`,
      payload: { snapshotId: SNAPSHOT_ID, bookId: BOOK_ID, ownerId: OWNER_ID },
    };
    const worker = startSnapshotWorker(60_000);
    await worker.processOnce();
    worker.stop();
    expect(createArchiveZip).not.toHaveBeenCalled();
    expect(mockState.completed).toHaveLength(1);
  });

  it('快照非 ready：非重试 fail 中文 reason', async () => {
    seedBook();
    mockState.snapshots.set(SNAPSHOT_ID, {
      id: SNAPSHOT_ID,
      bookId: BOOK_ID,
      ownerId: OWNER_ID,
      status: 'building',
      archiveObjectId: null,
    });
    mockState.nextJob = {
      id: 'job-7',
      kind: 'snapshot-archive',
      uniqueKey: `${SNAPSHOT_ID}:snapshot-archive`,
      payload: { snapshotId: SNAPSHOT_ID, bookId: BOOK_ID, ownerId: OWNER_ID },
    };
    const worker = startSnapshotWorker(60_000);
    await worker.processOnce();
    worker.stop();
    expect(mockState.failed).toHaveLength(1);
    expect(mockState.failed[0].retryable).toBe(false);
    expect(mockState.failed[0].reason).toContain('快照');
    expect(createArchiveZip).not.toHaveBeenCalled();
  });

  it('快照不属于该账号：非重试 fail', async () => {
    seedBook();
    mockState.snapshots.set(SNAPSHOT_ID, {
      id: SNAPSHOT_ID,
      bookId: BOOK_ID,
      ownerId: OTHER_OWNER,
      status: 'ready',
    });
    mockState.nextJob = {
      id: 'job-8',
      kind: 'snapshot-archive',
      uniqueKey: `${SNAPSHOT_ID}:snapshot-archive`,
      payload: { snapshotId: SNAPSHOT_ID, bookId: BOOK_ID, ownerId: OWNER_ID },
    };
    const worker = startSnapshotWorker(60_000);
    await worker.processOnce();
    worker.stop();
    expect(mockState.failed).toHaveLength(1);
    expect(mockState.failed[0].retryable).toBe(false);
  });

  it('对象存储瞬时错误：retryable fail', async () => {
    seedBook();
    seedReadySnapshot();
    const objId = randomUUID();
    mockState.snapshotObjects.set(SNAPSHOT_ID, [
      { objectId: objId, logicalPath: 'source/原始书籍.txt', category: 'source', state: 'present' },
    ]);
    mockState.assetObjects.set(objId, {
      id: objId, objectKey: `obj/${objId}`, sha256: 'a'.repeat(64), bytes: BigInt(5), mime: 'text/plain',
    });
    mockState.objectStoreGetError = new Error('连接超时');
    mockState.nextJob = {
      id: 'job-9',
      kind: 'snapshot-archive',
      uniqueKey: `${SNAPSHOT_ID}:snapshot-archive`,
      payload: { snapshotId: SNAPSHOT_ID, bookId: BOOK_ID, ownerId: OWNER_ID },
    };
    const worker = startSnapshotWorker(60_000);
    await worker.processOnce();
    worker.stop();
    expect(mockState.failed).toHaveLength(1);
    expect(mockState.failed[0].retryable).toBe(true);
  });
});
