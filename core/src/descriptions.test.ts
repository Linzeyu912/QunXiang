import { describe, expect, it } from 'vitest';
import { cleanEntityDescription, mergeEntityDescriptions } from './descriptions.js';

describe('entity description cleanup', () => {
  it('drops an obviously incomplete trailing fragment without changing earlier source-backed facts', () => {
    const description = cleanEntityDescription(
      '加玛帝国狮心元帅纳兰桀的孙女，与萧炎指腹为婚，此次奉师命前往萧家强行解除婚约，最终被萧炎以休书反将一'
    );

    expect(description).toContain('加玛帝国狮心元帅纳兰桀的孙女');
    expect(description).toContain('强行解除婚约');
    expect(description).not.toContain('反将一');
  });

  it('keeps complete complementary descriptions when merging batches', () => {
    const description = mergeEntityDescriptions(
      '萧家三少爷，曾被视为家族天才，后来斗之气倒退。',
      '身怀母亲遗留的黑色古戒，并在退婚冲突中写下休书。'
    );

    expect(description).toContain('萧家三少爷');
    expect(description).toContain('黑色古戒');
    expect(description).toContain('退婚冲突');
  });

  it('deduplicates contained descriptions while keeping the richer version', () => {
    const description = mergeEntityDescriptions(
      '萧家三少爷',
      '萧家三少爷，曾为天才少年后斗之气倒退'
    );

    expect(description).toBe('萧家三少爷，曾为天才少年后斗之气倒退');
  });

  it('collapses adjacent repeated short Chinese phrases introduced by fusion', () => {
    expect(cleanEntityDescription('白衣青年，性格高傲好色，轻浮轻浮。')).toBe(
      '白衣青年，性格高傲好色，轻浮'
    );
  });
});
