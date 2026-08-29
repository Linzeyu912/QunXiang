import { describe, expect, it } from 'vitest';
import {
  itemCategorySchema,
  itemSchema,
  normalizeWorldviewCategory,
  worldviewSchema,
} from './index.js';

describe('世界观类别宽容归一化', () => {
  it('合法枚举值原样保留', () => {
    expect(normalizeWorldviewCategory('worldview')).toBe('worldview');
    expect(normalizeWorldviewCategory('power-system')).toBe('power-system');
    expect(normalizeWorldviewCategory('realm')).toBe('realm');
    expect(normalizeWorldviewCategory('faction')).toBe('faction');
    expect(normalizeWorldviewCategory('rule')).toBe('rule');
  });

  it('中文类别与关键词映射到枚举值（LLM 保守输出不连累整批）', () => {
    expect(normalizeWorldviewCategory('力量体系')).toBe('power-system');
    expect(normalizeWorldviewCategory('魂力')).toBe('power-system');
    expect(normalizeWorldviewCategory('境界等级')).toBe('realm');
    expect(normalizeWorldviewCategory('组织势力')).toBe('faction');
    expect(normalizeWorldviewCategory('史莱克学院')).toBe('faction');
    expect(normalizeWorldviewCategory('规则法则')).toBe('rule');
  });

  it('无法识别的值兜底为 worldview', () => {
    expect(normalizeWorldviewCategory('')).toBe('worldview');
    expect(normalizeWorldviewCategory(undefined)).toBe('worldview');
    expect(normalizeWorldviewCategory(123)).toBe('worldview');
    expect(normalizeWorldviewCategory('乱七八糟')).toBe('worldview');
  });

  it('worldviewSchema 容忍中文类别与缺省类别', () => {
    const parsed = worldviewSchema.parse({ name: '斗气', category: '力量体系' });
    expect(parsed.category).toBe('power-system');
    const fallback = worldviewSchema.parse({ name: '斗气大陆' });
    expect(fallback.category).toBe('worldview');
  });
});

describe('道具大类', () => {
  it('category 缺省为 other，接受合法大类（含电子设备/文件信物）', () => {
    expect(itemSchema.parse({ name: '玄重尺' }).category).toBe('other');
    expect(itemSchema.parse({ name: '吸掌', category: 'skill' }).category).toBe('skill');
    expect(itemSchema.parse({ name: '聚气散', category: 'pill' }).category).toBe('pill');
    expect(itemSchema.parse({ name: '苹果笔记本', category: 'electronics' }).category).toBe('electronics');
    expect(itemSchema.parse({ name: '面试邀请信', category: 'document' }).category).toBe('document');
  });

  it('非法大类被拒绝', () => {
    expect(() => itemSchema.parse({ name: '玄重尺', category: '不存在的大类' })).toThrow();
    expect(itemCategorySchema.options).toEqual(['weapon', 'skill', 'food', 'pill', 'treasure', 'electronics', 'document', 'other']);
  });
});
