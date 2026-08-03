import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

const mockState = vi.hoisted(() => {
  return {
    shares: new Map<string, {
      id: string; bookId: string; snapshotId: string; senderId: string; recipientId: string;
      status: string; failureReason?: string | null;
    }>(),
    snapshots: new Map<string, {
      id: string; bookId: string; ownerId: string; version: number; contentRevision: string;
      status: string; manifestObjectId?: string | null; archiveObjectId?: string | null;
    }>(),
    snapshotObjects: new Map<string, Array<{
      objectId: string; logicalPath: string; category: string; state: string; reason?: string | null;
    }>>(),
    books: new Map<string, {
      id: string; title: string; userId: string; sourceBookId?: string | null;
      sourceShareId?: string | null; currentSnapshotId?: string | null;
    }>(),
    auditLogs: [] as any[],
    markCopyingResult: true as boolean,
    markCopyingCalls: [] as any[],
    markFailedCalls: [] as any[],
    transactionError: null as Error | null,
    txOps: {
      bookCreates: [] as any[],
      snapshotCreates: [] as any[],
      snapshotUpdates: [] as any[],
      snapshotObjectCreates: [] as any[],
      executeRaws: [] as any[],
      bookShareUpdates: [] as any[],
    },
    reset() {
      this.shares.clear(); this.snapshots.clear(); this.snapshotObjects.clear(); this.books.clear();
      this.auditLogs.length = 0; this.markCopyingResult = true;
      this.markCopyingCalls.length = 0; this.markFailedCalls.length = 0; this.transactionError = null;
      this.txOps.bookCreates.length = 0; this.txOps.snapshotCreates.length = 0;
      this.txOps.snapshotUpdates.length = 0; this.txOps.snapshotObjectCreates.length = 0;
      this.txOps.executeRaws.length = 0; this.txOps.bookShareUpdates.length = 0;
    },
  };
});

vi.mock('@novel-agent/storage', () => ({
  prisma: {
    $transaction: async (fn: (tx: any) => Promise<any>) => {
      if (mockState.transactionError) throw mockState.transactionError;
      const tx = {
        book: {
          create: async (input: any) => {
            mockState.txOps.bookCreates.push(input);
            const id = randomUUID();
            const row = { id, title: input.data.title, userId: input.data.userId, sourceBookId: input.data.sourceBookId ?? null, sourceShareId: input.data.sourceShareId ?? null, currentSnapshotId: null };
            mockState.books.set(id, row);
            return row;
          },
          findUnique: async ({ where }: { where: { id: string } }) => mockState.books.get(where.id) ?? null,
          findFirst: async ({ where }: { where: any }) => {
            for (const b of mockState.books.values()) {
              if (where.sourceShareId !== undefined && b.sourceShareId !== where.sourceShareId) continue;
              if (where.userId !== undefined && b.userId !== where.userId) continue;
              return b;
            }
            return null;
          },
        },
        assetSnapshot: {
          create: async (input: any) => {
            mockState.txOps.snapshotCreates.push(input);
            const id = randomUUID();
            const row = { id, bookId: input.data.bookId, ownerId: input.data.ownerId, version: input.data.version, contentRevision: input.data.contentRevision, status: input.data.status, manifestObjectId: null, archiveObjectId: null };
            mockState.snapshots.set(id, row);
            return row;
          },
          update: async (input: any) => {
            mockState.txOps.snapshotUpdates.push(input);
            const row = mockState.snapshots.get(input.where.id);
            if (row) Object.assign(row, input.data);
            return row;
          },
        },
        snapshotObject: {
          create: async (input: any) => { mockState.txOps.snapshotObjectCreates.push(input); return { id: randomUUID() }; },
        },
        bookShare: {
          updateMany: async (input: any) => {
            mockState.txOps.bookShareUpdates.push(input);
            const s = mockState.shares.get(input.where.id);
            if (s && s.status === 'copying') {
              s.status = input.data.status;
              s.failureReason = input.data.failureReason ?? null;
            }
            return { count: s ? 1 : 0 };
          },
        },
        $executeRaw: async (...args: any[]) => { mockState.txOps.executeRaws.push(args); return 1; },
      };
      return fn(tx);
    },
    book: {
      findUnique: async ({ where }: { where: { id: string } }) => mockState.books.get(where.id) ?? null,
      findFirst: async ({ where }: { where: any }) => {
        for (const b of mockState.books.values()) {
          if (where.sourceShareId !== undefined && b.sourceShareId !== where.sourceShareId) continue;
          if (where.userId !== undefined && b.userId !== where.userId) continue;
          return b;
        }
        return null;
      },
    },
  },
  BookShareRepository: {
    async findForRecipient(id: string, recipientId: string) {
      const s = mockState.shares.get(id);
      if (!s || s.recipientId !== recipientId) return null;
      return { ...s };
    },
    async markCopying(id: string, recipientId: string, snapshotId: string) {
      mockState.markCopyingCalls.push({ id, recipientId, snapshotId });
      if (!mockState.markCopyingResult) return false;
      const s = mockState.shares.get(id);
      if (s && s.status === 'active') s.status = 'copying';
      return mockState.markCopyingResult;
    },
    async markFailed(id: string, reason: string) {
      mockState.markFailedCalls.push({ id, reason });
      const s = mockState.shares.get(id);
      if (s && s.status === 'copying') { s.status = 'active'; s.failureReason = reason; }
      return s ? { ...s } : null;
    },
  },
  AssetSnapshotRepository: {
    async findOwnedById(id: string, ownerId: string) {
      const s = mockState.snapshots.get(id);
      if (!s || s.ownerId !== ownerId) return null;
      return { ...s };
    },
  },
  SnapshotObjectRepository: {
    async listForSnapshot(snapshotId: string) { return [...(mockState.snapshotObjects.get(snapshotId) ?? [])]; },
  },
  AuditLogRepository: {
    async create(input: any) { mockState.auditLogs.push(input); return { id: randomUUID(), ...input }; },
  },
}));

import { copyShareToLibrary } from './book-copy.js';

const SENDER_ID = '00000000-0000-4000-8000-000000000001';
const RECIPIENT_ID = '00000000-0000-4000-8000-000000000002';
const SHARE_ID = '00000000-0000-4000-8000-000000000003';
const SOURCE_BOOK_ID = '00000000-0000-4000-8000-000000000004';
const SOURCE_SNAPSHOT_ID = '00000000-0000-4000-8000-000000000005';
const MANIFEST_OBJECT_ID = '00000000-0000-4000-8000-000000000006';
const ARCHIVE_OBJECT_ID = '00000000-0000-4000-8000-000000000007';

function seedActiveShare(): void {
  mockState.shares.set(SHARE_ID, { id: SHARE_ID, bookId: SOURCE_BOOK_ID, snapshotId: SOURCE_SNAPSHOT_ID, senderId: SENDER_ID, recipientId: RECIPIENT_ID, status: 'active' });
}
function seedSourceBook(title = '源书'): void {
  mockState.books.set(SOURCE_BOOK_ID, { id: SOURCE_BOOK_ID, title, userId: SENDER_ID, sourceBookId: null, sourceShareId: null, currentSnapshotId: SOURCE_SNAPSHOT_ID });
}
function seedReadySourceSnapshot(): void {
  mockState.snapshots.set(SOURCE_SNAPSHOT_ID, { id: SOURCE_SNAPSHOT_ID, bookId: SOURCE_BOOK_ID, ownerId: SENDER_ID, version: 1, contentRevision: 'rev-1', status: 'ready', manifestObjectId: MANIFEST_OBJECT_ID, archiveObjectId: ARCHIVE_OBJECT_ID });
}
function seedSourceSnapshotObjects(): void {
  mockState.snapshotObjects.set(SOURCE_SNAPSHOT_ID, [
    { objectId: 'obj-1', logicalPath: 'source/原始书籍.txt', category: 'source', state: 'present' },
    { objectId: 'obj-2', logicalPath: 'manifest.json', category: 'manifest', state: 'present' },
    { objectId: 'obj-3', logicalPath: 'entities/characters.json', category: 'entity', state: 'empty', reason: '尚无该类实体' },
  ]);
}

describe('copyShareToLibrary', () => {
  beforeEach(() => {
    mockState.reset(); seedActiveShare(); seedSourceBook(); seedReadySourceSnapshot(); seedSourceSnapshotObjects();
    vi.clearAllMocks();
  });
  afterEach(() => vi.clearAllMocks());

  it('markCopying 失败（撤销竞态）→ noop 且不进入事务', async () => {
    mockState.markCopyingResult = false;
    const result = await copyShareToLibrary({ shareId: SHARE_ID, recipientId: RECIPIENT_ID });
    expect(result).toEqual({ noop: true });
    expect(mockState.txOps.bookCreates).toHaveLength(0);
    expect(mockState.txOps.bookShareUpdates).toHaveLength(0);
    expect(mockState.markFailedCalls).toHaveLength(0);
  });

  it('分享不存在 → 抛中文 + 不进入事务', async () => {
    await expect(copyShareToLibrary({ shareId: 'no-such-share', recipientId: RECIPIENT_ID })).rejects.toThrow(/分享不存在或不可复制/);
    expect(mockState.markCopyingCalls).toHaveLength(0);
    expect(mockState.txOps.bookCreates).toHaveLength(0);
  });

  it('分享已撤销 → 抛中文', async () => {
    mockState.shares.get(SHARE_ID)!.status = 'revoked';
    await expect(copyShareToLibrary({ shareId: SHARE_ID, recipientId: RECIPIENT_ID })).rejects.toThrow(/分享不存在或不可复制/);
    expect(mockState.markCopyingCalls).toHaveLength(0);
  });

  it('接收方不匹配视为不存在 → 抛中文', async () => {
    await expect(copyShareToLibrary({ shareId: SHARE_ID, recipientId: 'someone-else' })).rejects.toThrow(/分享不存在或不可复制/);
  });

  it('分享已 copied → 幂等按 sourceShareId 查回目标书', async () => {
    mockState.shares.get(SHARE_ID)!.status = 'copied';
    mockState.books.set('target-existing', { id: 'target-existing', title: '源书', userId: RECIPIENT_ID, sourceBookId: SOURCE_BOOK_ID, sourceShareId: SHARE_ID, currentSnapshotId: 'snap-old' });
    const result = await copyShareToLibrary({ shareId: SHARE_ID, recipientId: RECIPIENT_ID });
    expect(result).toEqual({ targetBookId: 'target-existing' });
    expect(mockState.markCopyingCalls).toHaveLength(0);
    expect(mockState.txOps.bookCreates).toHaveLength(0);
  });

  it('源快照非 ready → 抛中文 + markFailed 恢复 active + 不创建目标', async () => {
    mockState.snapshots.get(SOURCE_SNAPSHOT_ID)!.status = 'building';
    await expect(copyShareToLibrary({ shareId: SHARE_ID, recipientId: RECIPIENT_ID })).rejects.toThrow();
    expect(mockState.shares.get(SHARE_ID)!.status).toBe('active');
    expect(mockState.markFailedCalls).toHaveLength(1);
    expect(mockState.markFailedCalls[0].reason).toMatch(/[一-鿿]/);
    expect(mockState.txOps.bookCreates).toHaveLength(0);
    expect(mockState.txOps.bookShareUpdates).toHaveLength(0);
  });

  it('源快照缺 archiveObjectId → 抛中文 + markFailed 恢复', async () => {
    mockState.snapshots.get(SOURCE_SNAPSHOT_ID)!.archiveObjectId = null;
    await expect(copyShareToLibrary({ shareId: SHARE_ID, recipientId: RECIPIENT_ID })).rejects.toThrow();
    expect(mockState.markFailedCalls).toHaveLength(1);
    expect(mockState.shares.get(SHARE_ID)!.status).toBe('active');
  });

  it('源快照不属于发送者 → 抛中文 + markFailed 恢复', async () => {
    mockState.snapshots.get(SOURCE_SNAPSHOT_ID)!.ownerId = 'someone-else';
    await expect(copyShareToLibrary({ shareId: SHARE_ID, recipientId: RECIPIENT_ID })).rejects.toThrow();
    expect(mockState.markFailedCalls).toHaveLength(1);
    expect(mockState.shares.get(SHARE_ID)!.status).toBe('active');
  });

  it('事务抛错 → markFailed 恢复 + 目标不入库 + rethrow', async () => {
    const boom = new Error('数据库连接超时');
    mockState.transactionError = boom;
    await expect(copyShareToLibrary({ shareId: SHARE_ID, recipientId: RECIPIENT_ID })).rejects.toBe(boom);
    expect(mockState.markFailedCalls).toHaveLength(1);
    expect(mockState.shares.get(SHARE_ID)!.status).toBe('active');
    expect(mockState.txOps.bookCreates).toHaveLength(0);
    expect(mockState.txOps.bookShareUpdates).toHaveLength(0);
  });

  it('成功：创建目标 + 复用 objectId + ready/archive 复用 + 事务内 markCopied', async () => {
    const result = await copyShareToLibrary({ shareId: SHARE_ID, recipientId: RECIPIENT_ID });
    expect(result.targetBookId).toBeDefined();
    const targetBookId = result.targetBookId!;

    expect(mockState.txOps.bookCreates).toHaveLength(1);
    const bookData = mockState.txOps.bookCreates[0].data;
    expect(bookData.title).toBe('源书');
    expect(bookData.userId).toBe(RECIPIENT_ID);
    expect(bookData.sourceBookId).toBe(SOURCE_BOOK_ID);
    expect(bookData.sourceShareId).toBe(SHARE_ID);

    expect(mockState.txOps.snapshotCreates).toHaveLength(1);
    const snapshotData = mockState.txOps.snapshotCreates[0].data;
    expect(snapshotData.bookId).toBe(targetBookId);
    expect(snapshotData.ownerId).toBe(RECIPIENT_ID);
    expect(snapshotData.version).toBe(1);
    expect(snapshotData.contentRevision).toBe('rev-1');

    expect(mockState.txOps.snapshotObjectCreates).toHaveLength(3);
    const reusedObjectIds = mockState.txOps.snapshotObjectCreates.map((c) => c.data.objectId).sort();
    expect(reusedObjectIds).toEqual(['obj-1', 'obj-2', 'obj-3']);

    expect(mockState.txOps.snapshotUpdates).toHaveLength(1);
    const upd = mockState.txOps.snapshotUpdates[0].data;
    expect(upd.status).toBe('ready');
    expect(upd.manifestObjectId).toBe(MANIFEST_OBJECT_ID);
    expect(upd.archiveObjectId).toBe(ARCHIVE_OBJECT_ID);

    expect(mockState.txOps.executeRaws).toHaveLength(1);

    // markCopied 在事务内（tx.bookShare.updateMany），与目标记录原子
    expect(mockState.txOps.bookShareUpdates).toHaveLength(1);
    expect(mockState.txOps.bookShareUpdates[0].where.id).toBe(SHARE_ID);
    expect(mockState.txOps.bookShareUpdates[0].data.status).toBe('copied');
    expect(mockState.shares.get(SHARE_ID)!.status).toBe('copied');

    expect(mockState.auditLogs).toHaveLength(1);
    expect(mockState.auditLogs[0].action).toBe('BOOK_SHARE_COPIED');
    expect(mockState.auditLogs[0].metadata.targetBookId).toBe(targetBookId);
  });

  it('copying 状态自愈：事务内查到已建目标则补 markCopied，不重复创建', async () => {
    // 模拟之前 attempt：markCopying 已把 status 切到 copying，且目标书已存在
    mockState.shares.get(SHARE_ID)!.status = 'copying';
    mockState.books.set('target-prev', { id: 'target-prev', title: '源书', userId: RECIPIENT_ID, sourceBookId: SOURCE_BOOK_ID, sourceShareId: SHARE_ID, currentSnapshotId: 'snap-prev' });
    const result = await copyShareToLibrary({ shareId: SHARE_ID, recipientId: RECIPIENT_ID });
    expect(result.targetBookId).toBe('target-prev');
    // 不重复建目标
    expect(mockState.txOps.bookCreates).toHaveLength(0);
    // 事务内补 markCopied
    expect(mockState.txOps.bookShareUpdates).toHaveLength(1);
    expect(mockState.shares.get(SHARE_ID)!.status).toBe('copied');
  });

  it('注入 now 用于 readyAt / 事务内 markCopied 时间一致', async () => {
    const fixed = new Date('2026-07-20T00:00:00.000Z');
    await copyShareToLibrary({ shareId: SHARE_ID, recipientId: RECIPIENT_ID, now: fixed });
    expect(mockState.txOps.snapshotUpdates[0].data.readyAt).toBe(fixed);
    expect(mockState.txOps.bookShareUpdates[0].data.copiedAt).toBe(fixed);
  });
});
