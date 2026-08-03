import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  // 对象存储
  putResult: { objectKey: 'obj/aa/bb/key1', sha256: 'aaa', bytes: BigInt(5), mime: 'application/json', etag: 'aaa' },
  putShouldThrow: false,
  putCalls: [] as Array<{ body: Uint8Array; mime: string }>,
  // BookArtifact 仓库
  upsertShouldThrow: false,
  upsertCalls: [] as Array<{ bookId: string; logicalPath: string; category: string; objectKey: string; sha256: string; bytes: bigint; mime: string }>,
  artifactByPath: new Map<string, { objectKey: string }>(),
  // 用 Uint8Array 避免 vi.hoisted 中引用未初始化的 import
  getObjectBytes: new Uint8Array([123, 34, 120, 34, 58, 49, 125]) as Uint8Array, // '{"x":1}'
  reset() {
    this.putShouldThrow = false;
    this.upsertShouldThrow = false;
    this.putCalls.length = 0;
    this.upsertCalls.length = 0;
    this.artifactByPath.clear();
  },
}));

vi.mock('./book-artifact.repository.js', () => ({
  BookArtifactRepository: {
    async upsert(input: typeof mockState.upsertCalls[number]) {
      if (mockState.upsertShouldThrow) throw new Error('DB 不可用');
      mockState.upsertCalls.push({ ...input });
      return { id: 'art-1', ...input };
    },
    async findByBookAndPath(_bookId: string, logicalPath: string) {
      return mockState.artifactByPath.get(logicalPath) ?? null;
    },
  },
}));

vi.mock('./object-storage/index.js', () => ({
  getSharedObjectStore: () => ({
    async put(input: { body: Uint8Array; mime: string }) {
      if (mockState.putShouldThrow) throw new Error('对象存储不可用');
      mockState.putCalls.push({ body: input.body, mime: input.mime });
      return { ...mockState.putResult };
    },
    async get(_objectKey: string) {
      return { bytes: mockState.getObjectBytes };
    },
  }),
}));

import { persistBookArtifact, readBookArtifactJson, readBookArtifactText } from './book-artifact-store.js';

const BOOK_ID = '00000000-0000-4000-8000-000000000001';

describe('persistBookArtifact', () => {
  beforeEach(() => mockState.reset());

  it('put + upsert 协调：字符串 body 按 utf-8 编码，bytes 为 bigint', async () => {
    await persistBookArtifact({
      bookId: BOOK_ID,
      logicalPath: 'entities/characters.json',
      category: 'extraction',
      body: '{"name":"萧炎"}',
    });

    expect(mockState.putCalls).toHaveLength(1);
    expect(mockState.putCalls[0].mime).toBe('application/json');
    expect(Buffer.from(mockState.putCalls[0].body).toString('utf-8')).toBe('{"name":"萧炎"}');

    expect(mockState.upsertCalls).toHaveLength(1);
    const upsert = mockState.upsertCalls[0];
    expect(upsert.bookId).toBe(BOOK_ID);
    expect(upsert.logicalPath).toBe('entities/characters.json');
    expect(upsert.category).toBe('extraction');
    expect(upsert.objectKey).toBe('obj/aa/bb/key1');
    expect(typeof upsert.bytes).toBe('bigint');
    expect(upsert.bytes).toBe(5n);
  });

  it('对象存储失败时不抛（best-effort 双写过渡）', async () => {
    mockState.putShouldThrow = true;
    await expect(
      persistBookArtifact({ bookId: BOOK_ID, logicalPath: 'run-summary.json', category: 'run-summary', body: '{}' }),
    ).resolves.toBeUndefined();
    expect(mockState.upsertCalls).toHaveLength(0);
  });

  it('DB upsert 失败时不抛', async () => {
    mockState.upsertShouldThrow = true;
    await expect(
      persistBookArtifact({ bookId: BOOK_ID, logicalPath: 'run-summary.json', category: 'run-summary', body: '{}' }),
    ).resolves.toBeUndefined();
  });
});

describe('readBookArtifactText / readBookArtifactJson', () => {
  beforeEach(() => mockState.reset());

  it('有 BookArtifact 记录时从对象存储读出文本', async () => {
    mockState.artifactByPath.set('story-segments.json', { objectKey: 'obj/aa/bb/key1' });
    mockState.getObjectBytes = Buffer.from('hello');
    const text = await readBookArtifactText(BOOK_ID, 'story-segments.json');
    expect(text).toBe('hello');
  });

  it('无记录时返回 null（不抛）', async () => {
    const text = await readBookArtifactText(BOOK_ID, 'missing.json');
    expect(text).toBeNull();
  });

  it('readBookArtifactJson 解析对象存储返回的字节', async () => {
    mockState.artifactByPath.set('entities/events.json', { objectKey: 'obj/aa/bb/key2' });
    mockState.getObjectBytes = Buffer.from('{"events":[]}');
    const json = await readBookArtifactJson<{ events: unknown[] }>(BOOK_ID, 'entities/events.json');
    expect(json?.events).toEqual([]);
  });
});
