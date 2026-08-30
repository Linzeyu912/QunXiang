import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// LLM 提取器 mock：补跑服务只消费 extractEntities 的产出，不真正调 LLM
const fakeExtract = vi.fn();
vi.mock('@qunxiang/extractors', () => ({
  createExtractor: vi.fn(() => fakeExtract),
}));

// storage 部分_mock：DB/Repository 用真实实现，只替换对象存储读取（返回构造的原文）
const MOCK_SOURCE = '《测试书》\n第一章 山村\n\n韩立在山村中醒来。韩立摸了摸口袋。\n\n第二章 下山\n\n韩立告别村人下山。墨大夫收留了韩立。\n\n第三章 城镇\n\n韩立进入城镇，遇到厉飞雨。';
vi.mock('@qunxiang/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@qunxiang/storage')>();
  return {
    ...actual,
    getSharedAssetSourceResolver: () => ({
      readSourceText: async () => MOCK_SOURCE,
    }),
  };
});

import { prisma, TaskRepository, BookRepository } from '@qunxiang/storage';
import { testUserInput } from '../../../storage/src/test-fixtures.js';
import { retryFailedChapters, collectFailedChapterNumbers } from './retry-failed-chapters.service.js';

describe('失败章节增量补跑', () => {
  let bookId: string;
  let ownerId: string;

  beforeEach(async () => {
    fakeExtract.mockReset();
    await prisma.character.deleteMany({ where: { book: { title: { contains: '补跑测试' } } } });
    await prisma.book.deleteMany({ where: { title: { contains: '补跑测试' } } });
    await prisma.user.deleteMany({ where: { email: { contains: 'retry-failed' } } });

    const user = await prisma.user.create({ data: testUserInput('retry-failed@test', '补跑测试') });
    ownerId = user.id;
    const book = await prisma.book.create({
      data: {
        title: '补跑测试书',
        filePath: '',
        fileSize: 10,
        mimeType: 'text/plain',
        userId: ownerId,
        status: 'EXTRACTED',
      },
    });
    bookId = book.id;
  });

  afterEach(async () => {
    await prisma.character.deleteMany({ where: { bookId } });
    await prisma.task.deleteMany({ where: { bookId } });
    await prisma.book.deleteMany({ where: { id: bookId } });
    await prisma.user.deleteMany({ where: { id: ownerId } });
  });

  async function seedExtractorTask(failedBatches: unknown[] | null) {
    await TaskRepository.create({
      bookId,
      agentType: 'extractor',
      payload: { bookId },
      status: 'completed',
      result: failedBatches ? { failedBatches } : {},
    });
    // 其余阶段任务行（模拟已完成管道）
    for (const agentType of ['validator', 'reviewer'] as const) {
      await TaskRepository.create({ bookId, agentType, payload: { bookId }, status: 'completed' });
    }
  }

  it('从 failedBatches 展开章节号（闭区间并集、排序去重）', async () => {
    await seedExtractorTask([
      { batch: 0, error: 'x', chapterFrom: 12, chapterTo: 15 },
      { batch: 1, error: 'y', chapterFrom: 30, chapterTo: 30 },
      { batch: 2, error: 'z', chapterFrom: 13, chapterTo: 14 },
    ]);
    expect(await collectFailedChapterNumbers(bookId)).toEqual([12, 13, 14, 15, 30]);
  });

  it('增量合并：旧实体累加计数并集章节且保留已融合描述与审核状态，新实体插入 PENDING', async () => {
    await seedExtractorTask([{ batch: 0, error: 'x', chapterFrom: 1, chapterTo: 2 }]);
    // 库内已有：韩立（已融合描述、已审核、提及 100、出现 1-3 章）
    await prisma.character.create({
      data: {
        bookId,
        name: '韩立',
        description: '概括式融合简介',
        confidence: 0.95,
        status: 'APPROVED',
        reviewSource: 'USER',
        mentionCount: 100,
        dialogueCount: 10,
        chapterAppearances: [1, 2, 3],
        stableKey: 'n:韩立',
      },
    });

    // 补跑提取结果：韩立提及 +5（第 1-2 章），新角色墨大夫，幻觉角色（0 提及）
    fakeExtract.mockResolvedValue({
      characters: [
        { name: '韩立', aliases: ['二愣子'], description: '粗稿描述', confidence: 0.8, mentionCount: 5, dialogueCount: 2, chapterAppearances: [1, 2], firstChapter: 1, lastChapter: 2, coCharacters: ['墨大夫'] },
        { name: '墨大夫', aliases: [], description: '神秘老者', confidence: 0.7, mentionCount: 3, dialogueCount: 1, chapterAppearances: [2], firstChapter: 2, lastChapter: 2, coCharacters: [] },
        { name: '幻觉角色', aliases: [], description: '', confidence: 0.9, mentionCount: 0, dialogueCount: 0, chapterAppearances: [], coCharacters: [] },
      ],
      items: [],
      locations: [],
      worldviews: [],
      failedBatches: [],
      successfulBatches: 1,
      totalBatches: 1,
    });

    const result = await retryFailedChapters(bookId, ownerId);
    expect(result.stillFailedChapters).toEqual([]);
    expect(result.newEntities).toBe(1);
    expect(result.mergedEntities).toBe(1);

    const hanli = await prisma.character.findFirst({ where: { bookId, name: '韩立' } });
    expect(hanli?.mentionCount).toBe(105);
    expect(hanli?.dialogueCount).toBe(12);
    expect(hanli?.chapterAppearances).toEqual([1, 2, 3]);
    expect(hanli?.aliases).toContain('二愣子');
    expect(hanli?.description).toBe('概括式融合简介');
    expect(hanli?.status).toBe('APPROVED');
    expect(hanli?.reviewSource).toBe('USER');

    const mo = await prisma.character.findFirst({ where: { bookId, name: '墨大夫' } });
    expect(mo?.status).toBe('PENDING');
    expect(mo?.description).toBe('神秘老者');

    const ghost = await prisma.character.findFirst({ where: { bookId, name: '幻觉角色' } });
    expect(ghost).toBeNull();

    // 任务警告被清除
    expect(await collectFailedChapterNumbers(bookId)).toEqual([]);
  });

  it('无失败章节时直接返回空结果，不调 LLM', async () => {
    await seedExtractorTask(null);
    const result = await retryFailedChapters(bookId, ownerId);
    expect(result.retriedChapters).toEqual([]);
    expect(result.message).toContain('没有需要补跑');
    expect(fakeExtract).not.toHaveBeenCalled();
  });

  it('补跑后仍有失败章节时保留警告（更新为剩余章节）', async () => {
    await seedExtractorTask([{ batch: 0, error: 'x', chapterFrom: 1, chapterTo: 3 }]);
    fakeExtract.mockResolvedValue({
      characters: [],
      items: [],
      locations: [],
      worldviews: [],
      failedBatches: [{ batch: [{ index: 2, title: '', content: '' }], characters: [], items: [], locations: [], worldviews: [], error: 'still failing' }],
      successfulBatches: 0,
      totalBatches: 1,
    });

    const result = await retryFailedChapters(bookId, ownerId);
    expect(result.stillFailedChapters).toEqual([2]);
    expect(result.message).toContain('仍有 1 章失败');
    const remaining = await collectFailedChapterNumbers(bookId);
    expect(remaining).toContain(2);
    expect(remaining).not.toContain(1);
    expect(remaining).not.toContain(3);
  });
});
