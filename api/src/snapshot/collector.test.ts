import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';

// ---------- 共享 mock 状态 ----------
// 用 vi.hoisted 让 mock 工厂可以引用，并保证每条用例从干净状态起步。

const mockState = vi.hoisted(() => {
  return {
    objectStore: {
      data: new Map<string, { body: Uint8Array; mime: string }>(),
      putLog: [] as Array<{ sha256: string; mime: string; bytes: number }>,
      reset() {
        this.data.clear();
        this.putLog.length = 0;
      },
    },
    sourceText: '第一章 启程\n少年推开木门，踏上青山古道。\n',
    sourceBuffer: null as Buffer | null,
    sourceError: null as Error | null,
    assetObjects: new Map<string, {
      id: string;
      sha256: string;
      bytes: bigint;
      mime: string;
      objectKey: string;
      etag?: string;
    }>(),
    snapshots: new Map<string, {
      id: string;
      bookId: string;
      ownerId: string;
      status: string;
      contentRevision: string;
      manifestObjectId?: string;
      createdAt: Date;
    }>(),
    snapshotObjects: new Map<string, Array<{
      objectId: string;
      logicalPath: string;
      category: string;
      state: string;
      reason?: string;
    }>>(),
    characters: [] as any[],
    locations: [] as any[],
    items: [] as any[],
    reviewsByCharacter: new Map<string, any[]>(),
    keepLineNums: new Set<number>(),
    entityImages: [] as any[],
    runDiscoveryResult: null as { runDir: string; generatedAt: string } | null,
    fsFiles: new Map<string, Buffer | string>(),
    reset() {
      this.objectStore.reset();
      this.sourceText = '第一章 启程\n少年推开木门，踏上青山古道。\n';
      this.sourceBuffer = null;
      this.sourceError = null;
      this.assetObjects.clear();
      this.snapshots.clear();
      this.snapshotObjects.clear();
      this.characters = [];
      this.locations = [];
      this.items = [];
      this.reviewsByCharacter.clear();
      this.keepLineNums = new Set();
      this.entityImages = [];
      this.runDiscoveryResult = null;
      this.fsFiles.clear();
    },
  };
});

vi.mock('@qunxiang/storage', () => {
  function makeObjectKey(sha256: string): string {
    return `obj/${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}`;
  }

  return {
    getSharedObjectStore: () => ({
      async put(input: { body: Uint8Array; mime: string; sha256?: string }) {
        const sha256 = input.sha256 ?? createHash('sha256').update(input.body).digest('hex');
        const objectKey = makeObjectKey(sha256);
        mockState.objectStore.data.set(objectKey, { body: input.body, mime: input.mime });
        mockState.objectStore.putLog.push({ sha256, mime: input.mime, bytes: input.body.byteLength });
        return {
          objectKey,
          sha256,
          bytes: BigInt(input.body.byteLength),
          mime: input.mime,
          etag: sha256,
        };
      },
      async head(objectKey: string) {
        const entry = mockState.objectStore.data.get(objectKey);
        if (!entry) return null;
        const sha = objectKey.split('/').pop()!;
        return { objectKey, bytes: BigInt(entry.body.byteLength), mime: entry.mime, sha256: sha, etag: sha };
      },
      async get(objectKey: string) {
        const entry = mockState.objectStore.data.get(objectKey);
        if (!entry) throw new Error('对象不存在');
        const sha = objectKey.split('/').pop()!;
        return {
          bytes: entry.body,
          bytesTotal: BigInt(entry.body.byteLength),
          bytesStart: 0,
          bytesEndInclusive: entry.body.byteLength - 1,
          mime: entry.mime,
          etag: sha,
        };
      },
      async delete() {},
      async createDownloadUrl() {
        return { url: '/objects/dl?t=token', expiresAt: new Date(Date.now() + 1000), etag: 'x' };
      },
    }),
    getSharedAssetSourceResolver: () => ({
      async readSourceBuffer() {
        if (mockState.sourceError) throw mockState.sourceError;
        if (mockState.sourceBuffer) return mockState.sourceBuffer;
        return Buffer.from(mockState.sourceText, 'utf-8');
      },
      async readSourceText() {
        if (mockState.sourceError) throw mockState.sourceError;
        return mockState.sourceText;
      },
    }),
    AssetObjectRepository: {
      async putIfAbsent(input: any) {
        const existing = [...mockState.assetObjects.values()].find((o) => o.sha256 === input.sha256 && o.bytes === input.bytes);
        if (existing) return existing;
        const id = randomUUID();
        const row = {
          id,
          sha256: input.sha256,
          bytes: input.bytes,
          mime: input.mime,
          objectKey: input.objectKey,
          etag: input.etag,
        };
        mockState.assetObjects.set(id, row);
        return row;
      },
      async findById(id: string) {
        return mockState.assetObjects.get(id) ?? null;
      },
    },
    AssetSnapshotRepository: {
      async findOwnedById(id: string, ownerId: string) {
        const s = mockState.snapshots.get(id);
        if (!s || s.ownerId !== ownerId) return null;
        return { ...s };
      },
      async markReady(id: string, manifestObjectId: string) {
        const s = mockState.snapshots.get(id);
        if (!s || s.status !== 'building') return null;
        s.status = 'ready';
        s.manifestObjectId = manifestObjectId;
        return { ...s };
      },
    },
    SnapshotObjectRepository: {
      async bulkCreate(snapshotId: string, items: any[]) {
        const list = mockState.snapshotObjects.get(snapshotId) ?? [];
        for (const it of items) {
          if (list.find((r) => r.logicalPath === it.logicalPath)) {
            throw new Error('唯一约束冲突');
          }
          list.push(it);
        }
        mockState.snapshotObjects.set(snapshotId, list);
        return items.map(() => ({ id: randomUUID() }));
      },
      async listForSnapshot(snapshotId: string) {
        return [...(mockState.snapshotObjects.get(snapshotId) ?? [])];
      },
      async deleteForSnapshot(snapshotId: string) {
        const n = (mockState.snapshotObjects.get(snapshotId) ?? []).length;
        mockState.snapshotObjects.delete(snapshotId);
        return n;
      },
    },
    CharacterRepository: {
      async findByBookId() { return mockState.characters; },
    },
    LocationRepository: {
      async findByBookId() { return mockState.locations; },
    },
    ItemRepository: {
      async findByBookId() { return mockState.items; },
    },
    WorldviewRepository: {
      async findByBookId() { return []; },
    },
    ReviewRepository: {
      async findByCharacterId(characterId: string) {
        return mockState.reviewsByCharacter.get(characterId) ?? [];
      },
    },
    NoiseOverrideRepository: {
      async listKeepLineNums() { return new Set(mockState.keepLineNums); },
    },
    EntityImageRepository: {
      async findByBookId() { return mockState.entityImages; },
    },
  };
});

vi.mock('fs/promises', () => ({
  async readFile(path: string) {
    const key = String(path).replace(/\\/g, '/');
    const f = mockState.fsFiles.get(key);
    if (f === undefined) {
      const err: NodeJS.ErrnoException = new Error(`ENOENT: ${path}`);
      err.code = 'ENOENT';
      throw err;
    }
    return typeof f === 'string' ? Buffer.from(f, 'utf-8') : f;
  },
  async readdir(path: string) {
    const prefix = String(path).replace(/\\/g, '/') + '/';
    const entries = new Set<string>();
    for (const k of mockState.fsFiles.keys()) {
      if (!k.startsWith(prefix)) continue;
      const rest = k.slice(prefix.length);
      const seg = rest.split('/')[0];
      entries.add(seg);
    }
    return [...entries];
  },
  async stat(path: string) {
    const key = String(path).replace(/\\/g, '/');
    if (mockState.fsFiles.has(key)) {
      const f = mockState.fsFiles.get(key)!;
      const size = typeof f === 'string' ? Buffer.byteLength(f) : f.byteLength;
      return { size, mtimeMs: 0, isFile: () => true, isDirectory: () => false };
    }
    const prefix = key + '/';
    for (const k of mockState.fsFiles.keys()) {
      if (k.startsWith(prefix)) {
        return { size: 0, mtimeMs: 0, isFile: () => false, isDirectory: () => true };
      }
    }
    const err: NodeJS.ErrnoException = new Error(`ENOENT: ${path}`);
    err.code = 'ENOENT';
    throw err;
  },
}));

vi.mock('./run-discovery.js', () => ({
  discoverCurrentRun: vi.fn(async () => mockState.runDiscoveryResult),
}));

// 在 mock 注册后导入被测代码
import { collectSnapshot } from './collector.js';
import { discoverCurrentRun } from './run-discovery.js';
import { manifestSha256, buildManifest } from '../lib/manifest.js';
import { stableStringify } from '../lib/stable-json.js';

const BOOK_ID = '00000000-0000-4000-8000-000000000001';
const OWNER_ID = '00000000-0000-4000-8000-000000000002';
const SNAPSHOT_ID = '00000000-0000-4000-8000-000000000003';

function seedSnapshot(status = 'building'): void {
  mockState.snapshots.set(SNAPSHOT_ID, {
    id: SNAPSHOT_ID,
    bookId: BOOK_ID,
    ownerId: OWNER_ID,
    status,
    contentRevision: 'rev-1',
    createdAt: new Date('2026-07-19T00:00:00.000Z'),
  });
  mockState.snapshotObjects.set(SNAPSHOT_ID, []);
}

function bookFixture(): any {
  return {
    id: BOOK_ID,
    title: '测试书',
    filePath: '',
    sourceObjectKey: 'obj/aa/bb/source',
    userId: OWNER_ID,
    updatedAt: new Date('2026-07-19T00:00:00.000Z'),
  };
}

describe('collectSnapshot', () => {
  beforeEach(() => {
    mockState.reset();
    seedSnapshot();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('缺少原始内容来源时抛中文错误且不写任何快照对象', async () => {
    mockState.sourceError = new Error('书籍没有可读的原始内容来源');
    await expect(
      collectSnapshot({ book: bookFixture(), ownerId: OWNER_ID, snapshotId: SNAPSHOT_ID }),
    ).rejects.toThrow(/书籍没有可读的原始内容来源/);
    // 抛错时不应留下任何写入对象
    expect(mockState.objectStore.putLog).toEqual([]);
    expect(mockState.snapshots.get(SNAPSHOT_ID)!.status).toBe('building');
  });

  it('收集原始书籍并写入 source 类别 present', async () => {
    const result = await collectSnapshot({ book: bookFixture(), ownerId: OWNER_ID, snapshotId: SNAPSHOT_ID });
    expect(result.manifestObjectId).toBeTruthy();

    const items = mockState.snapshotObjects.get(SNAPSHOT_ID)!;
    const sourceItem = items.find((i) => i.logicalPath === 'source/原始书籍.txt');
    expect(sourceItem).toBeDefined();
    expect(sourceItem!.category).toBe('source');
    expect(sourceItem!.state).toBe('present');

    // 对象被去重写入
    expect(mockState.objectStore.putLog.length).toBeGreaterThan(0);
    // manifest 也作为对象写入
    const manifestItem = items.find((i) => i.category === 'manifest');
    expect(manifestItem).toBeDefined();

    // 快照置为 ready
    expect(mockState.snapshots.get(SNAPSHOT_ID)!.status).toBe('ready');
    expect(mockState.snapshots.get(SNAPSHOT_ID)!.manifestObjectId).toBe(result.manifestObjectId);
  });

  it('各类实体为空时 entities/empty.json 状态为 empty 且附中文原因', async () => {
    await collectSnapshot({ book: bookFixture(), ownerId: OWNER_ID, snapshotId: SNAPSHOT_ID });
    const items = mockState.snapshotObjects.get(SNAPSHOT_ID)!;
    // 空实体的文件存在，state=empty
    const charItem = items.find((i) => i.logicalPath === 'entities/characters.json');
    expect(charItem).toBeDefined();
    expect(charItem!.state).toBe('empty');
    expect(charItem!.reason).toBe('尚无该类实体');
  });

  it('数据库实体被序列化写入 entities/{type}.json', async () => {
    mockState.characters = [
      { id: 'c1', name: '少年', aliases: ['主角'], description: '勇敢', confidence: 0.9 },
    ];
    mockState.locations = [
      { id: 'l1', name: '青山古道', aliases: [], description: '山路', confidence: 0.8 },
    ];
    await collectSnapshot({ book: bookFixture(), ownerId: OWNER_ID, snapshotId: SNAPSHOT_ID });
    const items = mockState.snapshotObjects.get(SNAPSHOT_ID)!;
    const charItem = items.find((i) => i.logicalPath === 'entities/characters.json')!;
    expect(charItem.state).toBe('present');
    const obj = mockState.assetObjects.get(charItem.objectId)!;
    const body = mockState.objectStore.data.get(obj.objectKey)!.body;
    const parsed = JSON.parse(Buffer.from(body).toString('utf-8'));
    expect(parsed[0].name).toBe('少年');
  });

  it('未发现提取运行时 extraction 类别记为 not-generated 并附中文原因', async () => {
    mockState.runDiscoveryResult = null;
    await collectSnapshot({ book: bookFixture(), ownerId: OWNER_ID, snapshotId: SNAPSHOT_ID });
    const items = mockState.snapshotObjects.get(SNAPSHOT_ID)!;
    // 不应写入任何 extraction 文件
    expect(items.find((i) => i.category === 'extraction')).toBeUndefined();
    // not-generated 的语义在 manifest 类别中（读取 manifest 对象验证）
    const manifestItem = items.find((i) => i.category === 'manifest')!;
    const obj = mockState.assetObjects.get(manifestItem.objectId)!;
    const manifest = JSON.parse(Buffer.from(mockState.objectStore.data.get(obj.objectKey)!.body).toString('utf-8'));
    const extractionCat = manifest.categories.find((c: any) => c.category === 'extraction');
    expect(extractionCat).toBeDefined();
    expect(extractionCat.state).toBe('not-generated');
    expect(extractionCat.reason).toContain('提取');
  });

  it('发现提取运行时收集存在的产物文件（缺失文件跳过）', async () => {
    mockState.runDiscoveryResult = { runDir: 'run-2026', generatedAt: '2026-07-19T00:00:00.000Z' };
    mockState.fsFiles.set('output/run-2026/final/run-summary.json', JSON.stringify({ bookId: BOOK_ID, generatedAt: '2026-07-19T00:00:00.000Z' }));
    mockState.fsFiles.set('output/run-2026/entities/characters.json', JSON.stringify([{ name: '少年' }]));
    // prescan / 其他 entities 文件未提供，应跳过
    await collectSnapshot({ book: bookFixture(), ownerId: OWNER_ID, snapshotId: SNAPSHOT_ID });
    const items = mockState.snapshotObjects.get(SNAPSHOT_ID)!;
    const runSummary = items.find((i) => i.logicalPath === 'extraction/latest/run-summary.json');
    expect(runSummary).toBeDefined();
    expect(runSummary!.category).toBe('extraction');
    const entitiesChar = items.find((i) => i.logicalPath === 'extraction/latest/entities/characters.json');
    expect(entitiesChar).toBeDefined();
    // 缺失文件不出现
    expect(items.find((i) => i.logicalPath === 'extraction/latest/prescan/character.txt')).toBeUndefined();
  });

  it('未发现故事产物时 story 类别记为 not-generated', async () => {
    await collectSnapshot({ book: bookFixture(), ownerId: OWNER_ID, snapshotId: SNAPSHOT_ID });
    const items = mockState.snapshotObjects.get(SNAPSHOT_ID)!;
    const manifestItem = items.find((i) => i.category === 'manifest')!;
    const obj = mockState.assetObjects.get(manifestItem.objectId)!;
    const manifest = JSON.parse(Buffer.from(mockState.objectStore.data.get(obj.objectKey)!.body).toString('utf-8'));
    const storyCat = manifest.categories.find((c: any) => c.category === 'story');
    expect(storyCat.state).toBe('not-generated');
    expect(storyCat.reason).toContain('故事');
  });

  it('存在故事产物时收集 stories 目录', async () => {
    mockState.fsFiles.set(`output/${BOOK_ID}/story-segments.json`, JSON.stringify({ segments: [] }));
    mockState.fsFiles.set(`output/${BOOK_ID}/director-assignments.json`, JSON.stringify({ assignments: [] }));
    await collectSnapshot({ book: bookFixture(), ownerId: OWNER_ID, snapshotId: SNAPSHOT_ID });
    const items = mockState.snapshotObjects.get(SNAPSHOT_ID)!;
    expect(items.find((i) => i.logicalPath === 'stories/story-segments.json')).toBeDefined();
  });

  it('重复调用同一快照保持幂等（不产生重复 logicalPath）', async () => {
    const first = await collectSnapshot({ book: bookFixture(), ownerId: OWNER_ID, snapshotId: SNAPSHOT_ID });
    // 第二次直接复用已 ready 状态
    const second = await collectSnapshot({ book: bookFixture(), ownerId: OWNER_ID, snapshotId: SNAPSHOT_ID });
    expect(second.manifestObjectId).toBe(first.manifestObjectId);
    const items = mockState.snapshotObjects.get(SNAPSHOT_ID)!;
    const paths = items.map((i) => i.logicalPath);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('manifest 对同一快照确定性：内容哈希稳定', async () => {
    await collectSnapshot({ book: bookFixture(), ownerId: OWNER_ID, snapshotId: SNAPSHOT_ID });
    const items = mockState.snapshotObjects.get(SNAPSHOT_ID)!;
    const manifestItem = items.find((i) => i.category === 'manifest')!;
    const obj = mockState.assetObjects.get(manifestItem.objectId)!;
    const body = Buffer.from(mockState.objectStore.data.get(obj.objectKey)!.body).toString('utf-8');

    // 独立构建一遍 manifest，验证字段对应
    const files = items
      .filter((i) => i.category !== 'manifest')
      .map((i) => {
        const assetObj = mockState.assetObjects.get(i.objectId)!;
        return {
          logicalPath: i.logicalPath,
          bytes: Number(assetObj.bytes),
          mime: assetObj.mime,
          sha256: assetObj.sha256,
          etag: assetObj.etag,
        };
      });
    const rebuilt = buildManifest({
      bookId: BOOK_ID,
      snapshotId: SNAPSHOT_ID,
      generatedAt: '2026-07-19T00:00:00.000Z',
      sourceType: 'novel',
      categories: JSON.parse(body).categories,
      files,
    });
    expect(stableStringify(rebuilt)).toBe(stableStringify(JSON.parse(body)));
    expect(manifestSha256(rebuilt)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('调用 discoverCurrentRun 时使用 output 作为 outputRoot 与 bookId', async () => {
    mockState.runDiscoveryResult = { runDir: 'run-1', generatedAt: '2026-07-19T00:00:00.000Z' };
    await collectSnapshot({ book: bookFixture(), ownerId: OWNER_ID, snapshotId: SNAPSHOT_ID });
    expect(discoverCurrentRun).toHaveBeenCalledWith('output', BOOK_ID);
  });
});
