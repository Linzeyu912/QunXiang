import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  // BookArtifact + 对象存储返回的文本；null 表示无记录
  storeText: null as string | null,
  fsText: null as string | null,
  reset() { this.storeText = null; this.fsText = null; },
}));

// 优先层：BookArtifact + 对象存储（storage 层的 readBookArtifactText）
vi.mock('@qunxiang/storage', () => ({
  readBookArtifactText: vi.fn(async (_bookId: string, _logicalPath: string) => mockState.storeText),
  readBookArtifactJson: vi.fn(async (bookId: string, logicalPath: string) => {
    if (mockState.storeText === null) return null;
    try { return JSON.parse(mockState.storeText) as unknown; } catch { return null; }
  }),
}));

// 回退层：本机 output/
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(async (_path: string, _enc: string) => {
    if (mockState.fsText === null) {
      const err: NodeJS.ErrnoException = new Error('ENOENT');
      err.code = 'ENOENT';
      throw err;
    }
    return mockState.fsText;
  }),
}));

import { readArtifactJson, readArtifactText } from './artifact-store.js';
import { readBookArtifactText } from '@qunxiang/storage';
import { readFile } from 'node:fs/promises';

const BOOK_ID = '00000000-0000-4000-8000-000000000001';

describe('readArtifactText / readArtifactJson 读取优先级', () => {
  beforeEach(() => mockState.reset());

  it('BookArtifact 命中时从对象存储读，不走本机 output/', async () => {
    mockState.storeText = '{"from":"store"}';
    mockState.fsText = '{"from":"fs"}';

    const text = await readArtifactText(BOOK_ID, 'entities/characters.json', 'output/run/entities/characters.json');
    expect(text).toBe('{"from":"store"}');
    expect(readBookArtifactText).toHaveBeenCalledWith(BOOK_ID, 'entities/characters.json');
    expect(readFile).not.toHaveBeenCalled();
  });

  it('BookArtifact 无记录时回退本机 output/', async () => {
    mockState.storeText = null;
    mockState.fsText = '{"from":"fs"}';

    const text = await readArtifactText(BOOK_ID, 'story-segments.json', 'output/book/story-segments.json');
    expect(text).toBe('{"from":"fs"}');
    expect(readFile).toHaveBeenCalledWith('output/book/story-segments.json', 'utf-8');
  });

  it('BookArtifact 与本机都没有时返回 null', async () => {
    mockState.storeText = null;
    mockState.fsText = null;
    const text = await readArtifactText(BOOK_ID, 'run-summary.json', 'output/run/final/run-summary.json');
    expect(text).toBeNull();
  });

  it('readArtifactJson 解析 BookArtifact 返回的 JSON', async () => {
    mockState.storeText = JSON.stringify({ segments: [{ id: 's1' }] });
    const json = await readArtifactJson<{ segments: { id: string }[] }>(BOOK_ID, 'story-segments.json');
    expect(json?.segments[0].id).toBe('s1');
  });

  it('未提供 fsFallbackPath 且 BookArtifact 无记录时返回 null', async () => {
    mockState.storeText = null;
    const text = await readArtifactText(BOOK_ID, 'entities/events.json');
    expect(text).toBeNull();
  });
});
