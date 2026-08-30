import { describe, expect, it, vi } from 'vitest';

vi.mock('@qunxiang/llm', () => ({
  getDefaultProvider: vi.fn(),
  getApiKeyCount: vi.fn(() => 1),
  LLM_PROVIDERS: {},
}));
vi.mock('@qunxiang/storage', () => ({
  CharacterRepository: { findByOwnedBookId: vi.fn() },
  ReviewRepository: { findMergeRejectionsByOwnedBook: vi.fn(async () => []) },
  EntityReviewRepository: { findByBook: vi.fn(async () => []), create: vi.fn() },
}));

import { calibrateJudgeConfidence } from './character-merge.service.js';

const mk = (reasons: string[], chaptersA: number[], chaptersB: number[]) => ({
  reasons: reasons as Array<'称谓归一化' | '已提取别名匹配'>,
  primary: { name: 'A', aliases: [], description: '', confidence: 0.8, id: 'a', chapterAppearances: chaptersA },
  secondary: { name: 'B', aliases: [], description: '', confidence: 0.8, id: 'b', chapterAppearances: chaptersB },
});

describe('calibrateJudgeConfidence 证据校准', () => {
  it('别名互指 + 称谓归一双证据：上限 0.99', () => {
    const c = mk(['已提取别名匹配', '称谓归一化'], [1, 2, 3], [2, 3, 4]);
    expect(calibrateJudgeConfidence(c, 0.98)).toBe(0.98);
    expect(calibrateJudgeConfidence(c, 1)).toBe(0.99);
  });

  it('仅别名互指：上限 0.95，压掉 LLM 锚定的虚高自报值', () => {
    const c = mk(['已提取别名匹配'], [1, 2], [2, 3]);
    expect(calibrateJudgeConfidence(c, 0.95)).toBe(0.95);
    expect(calibrateJudgeConfidence(c, 0.99)).toBe(0.95);
  });

  it('仅称谓归一：上限 0.90', () => {
    const c = mk(['称谓归一化'], [1], [1]);
    expect(calibrateJudgeConfidence(c, 0.95)).toBe(0.9);
  });

  it('same 但出现章节几乎零重叠：上限再降 0.15（同人不可能不同框）', () => {
    const c = mk(['已提取别名匹配'], [1, 2, 3, 4, 5], [80, 81, 82, 83, 84]);
    expect(calibrateJudgeConfidence(c, 0.95)).toBe(0.8);
  });

  it('自报值低于上限时原样保留（只封顶不抬升）', () => {
    const c = mk(['已提取别名匹配', '称谓归一化'], [1, 2], [2, 3]);
    expect(calibrateJudgeConfidence(c, 0.72)).toBe(0.72);
  });
});
