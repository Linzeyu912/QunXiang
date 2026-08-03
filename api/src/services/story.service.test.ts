import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  // BookArtifact upsert 捕获
  persisted: [] as Array<{ bookId: string; logicalPath: string; category: string; body: string }>,
  // artifact-store 读取返回（按 logicalPath 索引）
  artifactJsonByPath: new Map<string, unknown>(),
  writtenFiles: [] as string[],
  reset() {
    this.persisted.length = 0;
    this.artifactJsonByPath.clear();
    this.writtenFiles.length = 0;
  },
}));

// storage：仅 stub writeJson 路径用到的 persistBookArtifact + BookRepository（鉴权）
vi.mock('@novel-agent/storage', () => ({
  BookRepository: {
    async findOwnedById(bookId: string, _ownerId: string) {
      return { id: bookId, title: '测试书', userId: _ownerId };
    },
  },
  BookArtifactRepository: {
    async findByBook() { return []; },
  },
  getSharedAssetSourceResolver: () => ({ async readSourceText() { return ''; } }),
  persistBookArtifact: vi.fn(async (input: { bookId: string; logicalPath: string; category: string; body: string }) => {
    mockState.persisted.push({ ...input });
  }),
}));

// artifact-store：注入 loadSegmentsDoc / loadReviewDoc 的读取结果
vi.mock('./artifact-store.js', () => ({
  readArtifactJson: vi.fn(async (_bookId: string, logicalPath: string) => {
    return mockState.artifactJsonByPath.get(logicalPath) ?? null;
  }),
}));

// fs：本机写盘改为捕获（不污染仓库工作区）
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(async () => undefined),
  writeFile: vi.fn(async (path: string) => { mockState.writtenFiles.push(String(path)); }),
  rm: vi.fn(async () => undefined),
}));

import { resolveBoundaryReview } from './story.service.js';
import { persistBookArtifact } from '@novel-agent/storage';

const BOOK_ID = '00000000-0000-4000-8000-000000000001';
const OWNER_ID = '00000000-0000-4000-8000-000000000002';

describe('story.service 产物对象化双写', () => {
  beforeEach(() => mockState.reset());

  it('resolveBoundaryReview(confirm) 后 story-boundary-review.json 写入 BookArtifact + 对象存储', async () => {
    // 预置一条 pending 边界审核项
    mockState.artifactJsonByPath.set('story-boundary-review.json', {
      bookId: BOOK_ID,
      items: [{
        id: 'review-story-1',
        bookId: BOOK_ID,
        segmentId: 'story-1',
        betweenChapter: [3, 4],
        suggestedDecision: 'confirm',
        confidence: 0.7,
        reason: '低置信度',
        leftSummary: '左',
        rightSummary: '右',
        evidence: { sharedCharacters: [], leftCharacters: [], rightCharacters: [], turningPoints: [] },
        canMerge: true,
        status: 'pending',
      }],
    });

    const result = await resolveBoundaryReview(BOOK_ID, OWNER_ID, 'review-story-1', 'confirm');

    expect(result.merged).toBe(false);
    expect(result.item.status).toBe('resolved');
    // 本机 output/ 写盘（双写过渡保留）
    expect(mockState.writtenFiles.some((p) => p.includes('story-boundary-review.json'))).toBe(true);
    // BookArtifact 收到 story 类目 upsert
    expect(persistBookArtifact).toHaveBeenCalledTimes(1);
    const call = mockState.persisted[0];
    expect(call.bookId).toBe(BOOK_ID);
    expect(call.logicalPath).toBe('story-boundary-review.json');
    expect(call.category).toBe('story');
    // 写入内容包含已裁决项
    const body = JSON.parse(call.body);
    expect(body.items[0].status).toBe('resolved');
    expect(body.items[0].resolvedDecision).toBe('confirm');
  });
});
