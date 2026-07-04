import { describe, expect, it } from 'vitest';
import { summarizeExtractionResult, EMPTY_EXTRACTION_REASON } from './extraction-result-summary.js';

/**
 * 空结果判定是历史 bug 的核心防护点：
 * "管道跑完但角色/场景/道具三类实体全空"曾被静默标成 completed，
 * 导致前端显示"已完成"而角色/场景页面为空。
 *
 * 这里直接对纯函数 summarizeExtractionResult 做断言——它正是 dispatcher
 * 在 reviewer 入库前用来决定"判失败 vs 继续入库"的依据。
 */
describe('summarizeExtractionResult (空结果守卫)', () => {
  it('三类全空时 totalCount === 0（触发 dispatcher 判失败）', () => {
    const summary = summarizeExtractionResult({ characters: [], locations: [], items: [] });
    expect(summary.totalCount).toBe(0);
    expect(summary.characters).toEqual([]);
    expect(summary.locations).toEqual([]);
    expect(summary.items).toEqual([]);
  });

  it('result 缺少 locations/items 键时按空数组处理，仍可能 totalCount === 0', () => {
    // extractor 只返回空 characters、没有 locations/items 字段的现实路径
    const summary = summarizeExtractionResult({ characters: [] });
    expect(summary.totalCount).toBe(0);
    expect(summary.locations).toEqual([]);
    expect(summary.items).toEqual([]);
  });

  it('只要有一类实体非空，totalCount > 0（不应判失败）', () => {
    expect(summarizeExtractionResult({ characters: [{ name: '萧炎' }], locations: [], items: [] }).totalCount).toBe(1);
    expect(summarizeExtractionResult({ characters: [], locations: [{ name: '乌坦城' }], items: [] }).totalCount).toBe(1);
    expect(summarizeExtractionResult({ characters: [], locations: [], items: [{ name: '青莲地心火' }] }).totalCount).toBe(1);
  });

  it('多类混合时正确累加', () => {
    const summary = summarizeExtractionResult({
      characters: [{ name: '萧炎' }, { name: '药老' }],
      locations: [{ name: '乌坦城' }],
      items: [{ name: '骨灵冷火' }, { name: '玄重尺' }],
    });
    expect(summary.totalCount).toBe(5);
  });

  it('对非对象 / null / 非数组的健壮处理，不抛错且 totalCount === 0', () => {
    expect(summarizeExtractionResult(null).totalCount).toBe(0);
    expect(summarizeExtractionResult(undefined).totalCount).toBe(0);
    expect(summarizeExtractionResult('not an object').totalCount).toBe(0);
    // characters 不是数组时按空处理，避免 .length 误用
    expect(summarizeExtractionResult({ characters: 'oops' }).totalCount).toBe(0);
  });

  it('EMPTY_EXTRACTION_REASON 是非空中文说明，供失败分支透传给前端', () => {
    expect(EMPTY_EXTRACTION_REASON).toBeTruthy();
    expect(EMPTY_EXTRACTION_REASON.length).toBeGreaterThan(5);
  });
});
