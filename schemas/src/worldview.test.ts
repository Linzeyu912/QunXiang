import { describe, expect, it } from 'vitest';
import { normalizeWorldviewCategory, worldviewSchema } from './worldview.js';

describe('世界观类别归一化', () => {
  it('保留合法类别并识别常见中文类别', () => {
    expect(normalizeWorldviewCategory('worldview')).toBe('worldview');
    expect(normalizeWorldviewCategory('力量体系')).toBe('power-system');
    expect(normalizeWorldviewCategory('境界等级')).toBe('realm');
    expect(normalizeWorldviewCategory('组织势力')).toBe('faction');
    expect(normalizeWorldviewCategory('规则法则')).toBe('rule');
  });

  it('无法识别的值兜底为世界观背景', () => {
    expect(normalizeWorldviewCategory('')).toBe('worldview');
    expect(normalizeWorldviewCategory(undefined)).toBe('worldview');
    expect(normalizeWorldviewCategory('未知分类')).toBe('worldview');
  });

  it('提取结构兼容中文类别与缺省类别', () => {
    expect(worldviewSchema.parse({ name: '斗气', category: '力量体系' }).category).toBe('power-system');
    expect(worldviewSchema.parse({ name: '斗气大陆' }).category).toBe('worldview');
  });
});
