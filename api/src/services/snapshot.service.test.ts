import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

const mockState = vi.hoisted(() => {
  return {
    snapshots: new Map<string, any>(),
    jobsByUniqueKey: new Map<string, any>(),
    enqueued: [] as any[],
    characters: [] as any[],
    locations: [] as any[],
    items: [] as any[],
    keepLineNums: new Set<number>(),
    run: { runDir: 'run-x', generatedAt: '2026-07-19T00:00:00.000Z' } as { runDir: string; generatedAt: string } | null,
    storySegmentsExists: false,
    objectStoreHeadBytes: BigInt(123),
    objectStoreUrl: '/objects/dl?t=abc',
    objectStoreGetBody: Buffer.from('archive'),
    enqueueFails: false,
    reset() {
      this.snapshots.clear();
      this.jobsByUniqueKey.clear();
      this.enqueued = [];
      this.characters = [];
      this.locations = [];
      this.items = [];
      this.keepLineNums = new Set();
      this.run = { runDir: 'run-x', generatedAt: '2026-07-19T00:00:00.000Z' };
      this.storySegmentsExists = false;
      this.enqueueFails = false;
    },
  };
});

vi.mock('@qunxiang/storage', () => {
  return {
    AssetSnapshotRepository: {
      async create(input: any) {
        const id = randomUUID();
        const maxVersion = [...mockState.snapshots.values()]
          .filter((s) => s.bookId === input.bookId)
          .reduce((m, s) => Math.max(m, s.version), 0);
        if (mockState.snapshots.has(`dup-${input.bookId}-${input.contentRevision}`)) {
          throw new Error('该成果版本已存在快照');
        }
        const row = {
          id,
          bookId: input.bookId,
          ownerId: input.ownerId,
          version: maxVersion + 1,
          contentRevision: input.contentRevision,
          status: 'building',
          manifestObjectId: null,
          archiveObjectId: null,
          failureReason: null,
          createdAt: input.now ?? new Date('2026-07-19T00:00:00.000Z'),
          readyAt: null,
        };
        mockState.snapshots.set(id, row);
        return row;
      },
      async findOwnedById(id: string, ownerId: string) {
        const s = mockState.snapshots.get(id);
        if (!s || s.ownerId !== ownerId) return null;
        return { ...s };
      },
      async findCurrentForBook(bookId: string, ownerId: string) {
        const list = [...mockState.snapshots.values()].filter((s) => s.bookId === bookId && s.ownerId === ownerId);
        return list.length === 0 ? null : { ...list[list.length - 1] };
      },
      async findByBookAndContentRevision(bookId: string, contentRevision: string) {
        const s = [...mockState.snapshots.values()].find(
          (x) => x.bookId === bookId && x.contentRevision === contentRevision && x.status !== 'failed',
        );
        return s ? { ...s } : null;
      },
      async deleteById(id: string) {
        mockState.snapshots.delete(id);
      },
      async markFailed(id: string, reason: string) {
        const s = mockState.snapshots.get(id);
        if (!s) return null;
        s.status = 'failed';
        s.failureReason = reason;
        return { ...s };
      },
    },
    AssetObjectRepository: {
      async findById(id: string) {
        return { id, objectKey: `obj/${id}`, sha256: 'a'.repeat(64), bytes: BigInt(123), mime: 'application/zip' };
      },
    },
    BackgroundJobRepository: {
      async enqueue(input: any) {
        if (mockState.enqueueFails) {
          throw new Error('数据库暂时不可用（模拟入队失败）');
        }
        mockState.enqueued.push(input);
        const existing = mockState.jobsByUniqueKey.get(input.uniqueKey);
        if (existing) return existing;
        const job = { id: randomUUID(), ...input, status: 'pending' };
        mockState.jobsByUniqueKey.set(input.uniqueKey, job);
        return job;
      },
      async findByUniqueKey(uniqueKey: string) {
        return mockState.jobsByUniqueKey.get(uniqueKey) ?? null;
      },
    },
    CharacterRepository: { async findByBookId() { return mockState.characters; } },
    LocationRepository: { async findByBookId() { return mockState.locations; } },
    ItemRepository: { async findByBookId() { return mockState.items; } },
    NoiseOverrideRepository: { async listKeepLineNums() { return new Set(mockState.keepLineNums); } },
    getSharedObjectStore: () => ({
      async createDownloadUrl() {
        return {
          url: mockState.objectStoreUrl,
          expiresAt: new Date(Date.now() + 600_000),
          etag: 'etag-x',
          bytes: mockState.objectStoreHeadBytes,
        };
      },
      async head() {
        return { bytes: mockState.objectStoreHeadBytes, mime: 'application/zip', etag: 'etag-x' };
      },
      async get() {
        return { bytes: mockState.objectStoreGetBody };
      },
    }),
    prisma: {
      book: {
        update: async ({ where, data }: any) => {
          // 模拟 currentSnapshotId 更新（用于准备完成后置位）
          return { id: where.id, ...data };
        },
      },
    },
  };
});

vi.mock('../snapshot/run-discovery.js', () => ({
  discoverCurrentRun: vi.fn(async () => mockState.run),
}));

vi.mock('fs/promises', () => ({
  stat: async (path: string) => {
    if (String(path).endsWith('story-segments.json') && mockState.storySegmentsExists) {
      return { isFile: () => true };
    }
    const err: NodeJS.ErrnoException = new Error('ENOENT');
    err.code = 'ENOENT';
    throw err;
  },
  readFile: async () => Buffer.from('{}'),
}));

import {
  prepareSnapshot,
  getDownloadState,
  getSnapshotSummary,
  authorizeDownload,
  buildContentRevisionInputs,
} from './snapshot.service.js';
import { createHash } from 'node:crypto';
import { stableStringify } from '../lib/stable-json.js';

const BOOK_ID = '00000000-0000-4000-8000-000000000001';
const OWNER_ID = '00000000-0000-4000-8000-000000000002';
const OTHER_OWNER = '00000000-0000-4000-8000-000000000003';

function bookFixture(): any {
  return {
    id: BOOK_ID,
    title: '测试书',
    filePath: '',
    sourceObjectKey: 'obj/aa/bb/source',
    updatedAt: new Date('2026-07-19T00:00:00.000Z'),
    userId: OWNER_ID,
  };
}

describe('buildContentRevisionInputs', () => {
  beforeEach(() => mockState.reset());

  it('相同输入得到相同 contentRevision', async () => {
    const a = await buildContentRevisionInputs(bookFixture());
    const b = await buildContentRevisionInputs(bookFixture());
    expect(a.contentRevision).toBe(b.contentRevision);
    expect(a.contentRevision).toMatch(/^[0-9a-f]{64}$/);
  });

  it('实体变化后 contentRevision 改变', async () => {
    const before = await buildContentRevisionInputs(bookFixture());
    mockState.characters = [{ id: 'c1', name: '少年' }];
    const after = await buildContentRevisionInputs(bookFixture());
    expect(after.contentRevision).not.toBe(before.contentRevision);
  });

  it('噪声覆盖集合变化后 contentRevision 改变', async () => {
    const before = await buildContentRevisionInputs(bookFixture());
    mockState.keepLineNums = new Set([1, 2, 3]);
    const after = await buildContentRevisionInputs(bookFixture());
    expect(after.contentRevision).not.toBe(before.contentRevision);
  });

  it('故事产物出现后 contentRevision 改变', async () => {
    const before = await buildContentRevisionInputs(bookFixture());
    mockState.storySegmentsExists = true;
    const after = await buildContentRevisionInputs(bookFixture());
    expect(after.contentRevision).not.toBe(before.contentRevision);
  });
});

describe('prepareSnapshot', () => {
  beforeEach(() => mockState.reset());

  it('首次调用创建新快照并入队 asset-snapshot 任务', async () => {
    const result = await prepareSnapshot(bookFixture(), OWNER_ID);
    expect(result.snapshotId).toBeTruthy();
    expect(result.state).toBe('preparing');
    expect(mockState.snapshots.get(result.snapshotId)).toBeTruthy();
    const enqueue = mockState.enqueued.find((e) => e.kind === 'asset-snapshot');
    expect(enqueue).toBeDefined();
    expect(enqueue.uniqueKey).toContain(BOOK_ID);
    expect(enqueue.uniqueKey).toContain('asset-snapshot');
    expect(enqueue.payload.snapshotId).toBe(result.snapshotId);
  });

  it('同 contentRevision 已存在非失败快照时复用且不重复入队', async () => {
    const first = await prepareSnapshot(bookFixture(), OWNER_ID);
    mockState.enqueued.length = 0;
    const second = await prepareSnapshot(bookFixture(), OWNER_ID);
    expect(second.snapshotId).toBe(first.snapshotId);
    expect(mockState.enqueued).toEqual([]);
  });

  it('contentRevision 变化后创建新版本快照', async () => {
    const first = await prepareSnapshot(bookFixture(), OWNER_ID);
    mockState.characters = [{ id: 'c1', name: '少年' }];
    const second = await prepareSnapshot(bookFixture(), OWNER_ID);
    expect(second.snapshotId).not.toBe(first.snapshotId);
  });

  it('任务入队失败时把新快照标为 failed，下次 prepare 删除重建（不再永久 preparing）', async () => {
    mockState.enqueueFails = true;
    await expect(prepareSnapshot(bookFixture(), OWNER_ID)).rejects.toThrow('入队失败');
    const failed = [...mockState.snapshots.values()].find((s) => s.bookId === BOOK_ID);
    expect(failed?.status).toBe('failed');
    expect(failed?.failureReason).toContain('入队失败');

    // 入队恢复后：失败快照被清除并重建（P0-2 路径），任务成功投递
    mockState.enqueueFails = false;
    const retried = await prepareSnapshot(bookFixture(), OWNER_ID);
    expect(retried.state).toBe('preparing');
    expect(mockState.snapshots.get(retried.snapshotId)?.status).toBe('building');
    expect(mockState.enqueued.filter((e) => e.kind === 'asset-snapshot')).toHaveLength(1);
  });
});

describe('getDownloadState', () => {
  beforeEach(() => mockState.reset());

  it('无快照返回 not-prepared', async () => {
    const state = await getDownloadState(bookFixture(), OWNER_ID);
    expect(state.state).toBe('not-prepared');
  });

  it('building 快照返回 preparing', async () => {
    await prepareSnapshot(bookFixture(), OWNER_ID);
    const state = await getDownloadState(bookFixture(), OWNER_ID);
    expect(state.state).toBe('preparing');
  });

  it('ready 且 contentRevision 一致返回 ready', async () => {
    const prepared = await prepareSnapshot(bookFixture(), OWNER_ID);
    const s = mockState.snapshots.get(prepared.snapshotId);
    s.status = 'ready';
    s.readyAt = new Date();
    s.manifestObjectId = randomUUID();
    s.archiveObjectId = randomUUID();
    const state = await getDownloadState(bookFixture(), OWNER_ID);
    expect(state.state).toBe('ready');
    expect(state.snapshotVersion).toBe(1);
  });

  it('ready 但 contentRevision 漂移返回 needs-update', async () => {
    const prepared = await prepareSnapshot(bookFixture(), OWNER_ID);
    const s = mockState.snapshots.get(prepared.snapshotId);
    s.status = 'ready';
    s.readyAt = new Date();
    s.archiveObjectId = randomUUID();
    s.manifestObjectId = randomUUID();
    mockState.characters = [{ id: 'c1', name: '少年' }]; // 改变成果
    const state = await getDownloadState(bookFixture(), OWNER_ID);
    expect(state.state).toBe('needs-update');
  });

  it('failed 快照返回 failed 与原因', async () => {
    const prepared = await prepareSnapshot(bookFixture(), OWNER_ID);
    const s = mockState.snapshots.get(prepared.snapshotId);
    s.status = 'failed';
    s.failureReason = '对象存储暂时不可用';
    const state = await getDownloadState(bookFixture(), OWNER_ID);
    expect(state.state).toBe('failed');
    expect(state.failureReason).toBe('对象存储暂时不可用');
  });
});

describe('getSnapshotSummary', () => {
  beforeEach(() => mockState.reset());

  it('返回脱敏摘要（不含对象键/签名）', async () => {
    const prepared = await prepareSnapshot(bookFixture(), OWNER_ID);
    const s = mockState.snapshots.get(prepared.snapshotId);
    s.status = 'ready';
    s.readyAt = new Date('2026-07-19T01:00:00.000Z');
    s.archiveObjectId = randomUUID();
    s.manifestObjectId = randomUUID();
    const summary = await getSnapshotSummary(bookFixture(), prepared.snapshotId, OWNER_ID);
    expect(summary).not.toBeNull();
    expect(summary!.version).toBe(1);
    expect(summary!.status).toBe('ready');
    expect(summary).not.toHaveProperty('archiveObjectId');
    expect(summary!).not.toHaveProperty('manifestObjectId');
    expect(JSON.stringify(summary)).not.toContain('obj/');
  });

  it('不属当前账号返回 null', async () => {
    const prepared = await prepareSnapshot(bookFixture(), OWNER_ID);
    const summary = await getSnapshotSummary(bookFixture(), prepared.snapshotId, OTHER_OWNER);
    expect(summary).toBeNull();
  });
});

describe('authorizeDownload', () => {
  beforeEach(() => mockState.reset());

  it('未 ready 抛中文错误', async () => {
    const prepared = await prepareSnapshot(bookFixture(), OWNER_ID);
    await expect(authorizeDownload(bookFixture(), prepared.snapshotId, OWNER_ID)).rejects.toThrow(
      /尚未准备完成/,
    );
  });

  it('ready 但未打包（无 archiveObjectId）抛中文错误', async () => {
    const prepared = await prepareSnapshot(bookFixture(), OWNER_ID);
    const s = mockState.snapshots.get(prepared.snapshotId);
    s.status = 'ready';
    s.manifestObjectId = randomUUID();
    await expect(authorizeDownload(bookFixture(), prepared.snapshotId, OWNER_ID)).rejects.toThrow(
      /尚未准备完成/,
    );
  });

  it('ready 且已打包返回签名地址与字节数', async () => {
    const prepared = await prepareSnapshot(bookFixture(), OWNER_ID);
    const s = mockState.snapshots.get(prepared.snapshotId);
    s.status = 'ready';
    s.manifestObjectId = randomUUID();
    s.archiveObjectId = randomUUID();
    const auth = await authorizeDownload(bookFixture(), prepared.snapshotId, OWNER_ID);
    expect(auth.url).toContain('/objects/dl');
    expect(auth.bytes).toBeGreaterThan(0);
    expect(auth.expiresAt).toBeInstanceOf(Date);
    expect(auth.etag).toBeTruthy();
  });

  it('不属当前账号抛 not-found 风格错误', async () => {
    const prepared = await prepareSnapshot(bookFixture(), OWNER_ID);
    await expect(authorizeDownload(bookFixture(), prepared.snapshotId, OTHER_OWNER)).rejects.toThrow();
  });
});

// 防止未使用 import 报错
void createHash;
void stableStringify;
