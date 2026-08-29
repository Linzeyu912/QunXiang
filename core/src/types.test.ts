import { describe, expect, it } from 'vitest';
import { calibrateConfidence, isLowConfidenceEntity, LOW_CONFIDENCE_THRESHOLD } from './types.js';

describe('calibrateConfidence', () => {
  it('仅出现 1 次的边缘角色即使 LLM 自报 0.9 也会落入低置信度区间', () => {
    const c = calibrateConfidence(0.9, { mentionCount: 1, chapterCount: 1, dialogueCount: 0 });
    expect(c).toBeLessThan(LOW_CONFIDENCE_THRESHOLD);
    expect(c).toBeGreaterThan(0.3);
  });

  it('LLM 未给置信度时按 0.7 先验处理，1 次提及仍进低置信度库', () => {
    const c = calibrateConfidence(undefined, { mentionCount: 1, chapterCount: 1, dialogueCount: 0 });
    expect(c).toBeLessThan(LOW_CONFIDENCE_THRESHOLD);
  });

  it('高频跨章的主角维持在 0.9 以上', () => {
    const c = calibrateConfidence(0.9, { mentionCount: 500, chapterCount: 30, dialogueCount: 100 });
    expect(c).toBeGreaterThanOrEqual(0.9);
  });

  it('无对话信号的场景/道具：仅 2 次提及落低置信度，10 次提及进主列表', () => {
    const low = calibrateConfidence(0.85, { mentionCount: 2, chapterCount: 2 });
    const main = calibrateConfidence(0.85, { mentionCount: 10, chapterCount: 5 });
    expect(low).toBeLessThan(LOW_CONFIDENCE_THRESHOLD);
    expect(main).toBeGreaterThanOrEqual(LOW_CONFIDENCE_THRESHOLD);
  });

  it('自报先验被压缩到 [0.3, 0.95]：自报 1.0 与 0.9 的差距不超过 0.05', () => {
    const ev = { mentionCount: 1000, chapterCount: 50, dialogueCount: 500 };
    const capped = calibrateConfidence(1, ev);
    const high = calibrateConfidence(0.9, ev);
    expect(capped - high).toBeLessThanOrEqual(0.05);
    // 自报 0 但证据充分：先验下限 0.3 兜底，证据仍可把结果拉回主列表区间
    const floored = calibrateConfidence(0, ev);
    expect(floored).toBeGreaterThanOrEqual(0.6);
  });

  it('证据越多置信度单调不减', () => {
    const weak = calibrateConfidence(0.9, { mentionCount: 2, chapterCount: 1, dialogueCount: 0 });
    const mid = calibrateConfidence(0.9, { mentionCount: 5, chapterCount: 3, dialogueCount: 2 });
    const strong = calibrateConfidence(0.9, { mentionCount: 20, chapterCount: 8, dialogueCount: 10 });
    expect(weak).toBeLessThan(mid);
    expect(mid).toBeLessThan(strong);
  });

  it('提供总章数时章节覆盖按书长归一：同样 5 章，短书得高分、长书得低分', () => {
    const short = calibrateConfidence(0.85, { mentionCount: 8, chapterCount: 5, totalChapters: 17 });
    const long = calibrateConfidence(0.85, { mentionCount: 8, chapterCount: 5, totalChapters: 2000 });
    expect(short).toBeGreaterThan(long);
    // 覆盖过半章节得满分：17 章的书出现 9 章 ≥ ceil(17/2)
    const half = calibrateConfidence(0.85, { mentionCount: 8, chapterCount: 9, totalChapters: 17 });
    const full = calibrateConfidence(0.85, { mentionCount: 50, chapterCount: 17, totalChapters: 17 });
    expect(half).toBeGreaterThan(0.7);
    expect(full).toBeGreaterThanOrEqual(0.85);
  });

  it('结果保留三位小数，避免浮点尾数', () => {
    const c = calibrateConfidence(0.87, { mentionCount: 7, chapterCount: 4, dialogueCount: 3 });
    expect(Number(c.toFixed(3))).toBe(c);
  });
});

describe('isLowConfidenceEntity', () => {
  it('低置信度且待审核 → 进库；已通过/已移除不受影响', () => {
    expect(isLowConfidenceEntity({ confidence: 0.5, status: 'PENDING' })).toBe(true);
    expect(isLowConfidenceEntity({ confidence: 0.5, status: 'APPROVED' })).toBe(false);
    // 已移除（REJECTED）的条目不再留在低置信度库里
    expect(isLowConfidenceEntity({ confidence: 0.5, status: 'REJECTED' })).toBe(false);
    expect(isLowConfidenceEntity({ confidence: 0.8, status: 'PENDING' })).toBe(false);
  });
});
