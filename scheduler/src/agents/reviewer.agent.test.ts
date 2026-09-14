import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Character } from '@qunxiang/core';

// ── 模块级 mock（vitest 工厂在首次 import 时执行，与 resolution.agent.test.ts 同构） ──
const chatExtract = vi.fn();
const isConfigured = vi.fn(async () => true);
const getDefaultProvider = vi.fn(async () => ({ chatExtract, isConfigured }));

vi.mock('@qunxiang/llm', () => ({ getDefaultProvider }));

const findByOwnedBookId = vi.fn();
const findMergeRejectionsByOwnedBook = vi.fn(async () => []);
const mergeOwned = vi.fn();
const updateOwned = vi.fn();
const entityReviewCreate = vi.fn(async () => ({ id: 'er-1' }));

vi.mock('@qunxiang/storage', () => ({
  CharacterRepository: { findByOwnedBookId, mergeOwned, updateOwned },
  ReviewRepository: { findMergeRejectionsByOwnedBook },
  EntityReviewRepository: { create: entityReviewCreate },
}));

function character(overrides: Partial<Character> & Pick<Character, 'id' | 'name'>): Character {
  return {
    bookId: 'book-1',
    aliases: [],
    description: '',
    confidence: 0.8,
    status: 'PENDING',
    chapterAppearances: [],
    mentionCount: 0,
    dialogueCount: 0,
    coCharacters: [],
    outfits: [],
    createdAt: new Date('2026-09-11T00:00:00Z'),
    reviewSource: 'AI',
    ...overrides,
  };
}

describe('executeReviewer 最终实体审核', () => {
  beforeEach(() => {
    chatExtract.mockReset();
    isConfigured.mockReset();
    isConfigured.mockResolvedValue(true);
    getDefaultProvider.mockReset();
    getDefaultProvider.mockResolvedValue({ chatExtract, isConfigured });
    findByOwnedBookId.mockReset();
    findMergeRejectionsByOwnedBook.mockReset();
    findMergeRejectionsByOwnedBook.mockResolvedValue([]);
    mergeOwned.mockReset();
    updateOwned.mockReset();
    entityReviewCreate.mockReset();
    entityReviewCreate.mockResolvedValue({ id: 'er-1' });
  });

  it('高置信（≥0.9）同一人物自动合并，且规范正名（宁荣荣）优先作 primary', async () => {
    const { executeReviewer } = await import('./reviewer.agent.js');
    const rongrong = character({
      id: 'c-rongrong', name: '荣荣', confidence: 0.9, mentionCount: 500,
      chapterAppearances: [10, 20, 30],
    });
    const ning = character({
      id: 'c-ning', name: '宁荣荣', confidence: 0.7, mentionCount: 200,
      chapterAppearances: [5, 20, 30],
    });
    findByOwnedBookId.mockResolvedValue([rongrong, ning]);
    // 去姓变体对规则优先：即使 LLM 的 canonicalName 指向昵称侧（'B'），也保留宁荣荣作正名
    chatExtract.mockResolvedValue({ verdict: 'same', confidence: 0.95, canonicalName: 'B', reason: '去姓后同名且描述一致' });
    mergeOwned.mockResolvedValue(character({ id: 'c-ning', name: '宁荣荣', aliases: ['荣荣'] }));

    const result = await executeReviewer({ bookId: 'book-1', userId: 'user-1', llmProfileId: 'p-kimi' });

    expect(result.audited).toBe(true);
    expect(result.autoMerged).toBe(1);
    expect(result.suggested).toBe(0);
    // primary=宁荣荣（规范正名），secondary=荣荣 → 解决「昵称当正名」
    expect(mergeOwned).toHaveBeenCalledWith('c-ning', 'c-rongrong', 'user-1', 'user-1');
    // 审核留痕：SYSTEM 来源的 MERGE_ACCEPTED
    const accepted = entityReviewCreate.mock.calls.find(([input]) => (input as { action: string }).action === 'MERGE_ACCEPTED');
    expect(accepted).toBeTruthy();
    expect((accepted![0] as { actorType: string }).actorType).toBe('SYSTEM');
    // provider 按运行绑定的档案解析
    expect(getDefaultProvider).toHaveBeenCalledWith('p-kimi');
  });

  it('置信度 0.7~0.9 只生成建议，不自动合并', async () => {
    const { executeReviewer } = await import('./reviewer.agent.js');
    findByOwnedBookId.mockResolvedValue([
      character({ id: 'c-1', name: '宁荣荣', confidence: 0.8, chapterAppearances: [10, 20] }),
      character({ id: 'c-2', name: '荣荣', confidence: 0.7, chapterAppearances: [20, 30] }),
    ]);
    chatExtract.mockResolvedValue({ verdict: 'same', confidence: 0.8, canonicalName: 'A', reason: '名称相近' });

    const result = await executeReviewer({ bookId: 'book-1', userId: 'user-1' });

    expect(result.autoMerged).toBe(0);
    expect(result.suggested).toBe(1);
    expect(mergeOwned).not.toHaveBeenCalled();
    const suggested = entityReviewCreate.mock.calls.find(([input]) => (input as { action: string }).action === 'MERGE_SUGGESTED');
    expect(suggested).toBeTruthy();
  });

  it('用户已审核过的实体即使高置信也只给建议（人工数据不自动合并）', async () => {
    const { executeReviewer } = await import('./reviewer.agent.js');
    findByOwnedBookId.mockResolvedValue([
      character({ id: 'c-1', name: '宁荣荣', confidence: 0.9, chapterAppearances: [10, 20], reviewSource: 'USER' }),
      character({ id: 'c-2', name: '荣荣', confidence: 0.7, chapterAppearances: [20, 30] }),
    ]);
    chatExtract.mockResolvedValue({ verdict: 'same', confidence: 0.95, canonicalName: 'A', reason: '硬证据' });

    const result = await executeReviewer({ bookId: 'book-1', userId: 'user-1' });

    expect(result.autoMerged).toBe(0);
    expect(result.suggested).toBe(1);
    expect(mergeOwned).not.toHaveBeenCalled();
  });

  it('正名与别名治理：昵称作正名时交换全名，并删除称谓后缀冗余别名', async () => {
    const { executeReviewer } = await import('./reviewer.agent.js');
    const c = character({
      id: 'c-rongrong', name: '荣荣',
      aliases: ['宁荣荣', '宁荣荣小姐', '宁荣荣姑娘', '荣荣姐', '九彩斗罗'],
    });
    findByOwnedBookId.mockResolvedValue([c]);
    updateOwned.mockImplementation(async (_id: string, _ownerId: string, data: Partial<Character>) =>
      ({ ...c, ...data }) as Character);

    const result = await executeReviewer({ bookId: 'book-1', userId: 'user-1' });

    expect(result.autoMerged).toBe(0);
    expect(result.canonicalSwapped).toBe(1);
    expect(result.aliasCleaned).toBe(1);
    expect(updateOwned).toHaveBeenCalledWith(
      'c-rongrong', 'user-1',
      expect.objectContaining({
        name: '宁荣荣',
        // 正名换成宁荣荣后：荣荣转入别名；宁荣荣小姐/宁荣荣姑娘/荣荣姐为冗余被删；九彩斗罗保留
        aliases: ['荣荣', '九彩斗罗'],
      }),
    );
  });

  it('正名字段被锁定时跳过交换', async () => {
    const { executeReviewer } = await import('./reviewer.agent.js');
    findByOwnedBookId.mockResolvedValue([
      character({ id: 'c-rongrong', name: '荣荣', aliases: ['宁荣荣'], lockedFields: ['name'] }),
    ]);

    const result = await executeReviewer({ bookId: 'book-1', userId: 'user-1' });

    expect(result.canonicalSwapped).toBe(0);
    expect(updateOwned).not.toHaveBeenCalled();
  });

  it('模型不可用时降级为提示，不失败、不合并', async () => {
    const { executeReviewer } = await import('./reviewer.agent.js');
    findByOwnedBookId.mockResolvedValue([
      character({ id: 'c-1', name: '宁荣荣', confidence: 0.9, chapterAppearances: [10, 20] }),
      character({ id: 'c-2', name: '荣荣', confidence: 0.7, chapterAppearances: [20, 30] }),
    ]);
    isConfigured.mockResolvedValue(false);

    const result = await executeReviewer({ bookId: 'book-1', userId: 'user-1' });

    expect(result.audited).toBe(false);
    expect(result.autoMerged).toBe(0);
    expect(result.message).toContain('转人工');
    expect(mergeOwned).not.toHaveBeenCalled();
  });

  it('缺少 bookId/userId 或仓储异常时审核降级，绝不让管线失败', async () => {
    const { executeReviewer } = await import('./reviewer.agent.js');
    const missing = await executeReviewer({ characters: [{ name: 'x' }] });
    expect(missing.audited).toBe(false);
    expect(missing.message).toContain('跳过最终审核');

    findByOwnedBookId.mockRejectedValue(new Error('数据库连接失败'));
    const errored = await executeReviewer({ bookId: 'book-1', userId: 'user-1' });
    expect(errored.audited).toBe(false);
    expect(errored.message).toContain('不受影响');
  });
});
