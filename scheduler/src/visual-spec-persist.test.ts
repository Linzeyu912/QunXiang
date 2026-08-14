import { describe, expect, it } from 'vitest';
import {
  ageVariantKey,
  buildVisualSpecDrafts,
  collectPromptsFromResult,
  expandPromptToDrafts,
  outfitVariantKey,
  pickActiveSpec,
  slugOutfitKey,
} from './visual-spec-persist.js';

describe('visual-spec-persist', () => {
  it('builds primary + age + outfit drafts from a character prompt', () => {
    const drafts = expandPromptToDrafts('book-1', {
      entityName: '萧炎',
      entityType: 'character',
      prompt: 'primary prompt',
      source: 'llm-polished',
      quality: 'high',
      styleTags: ['xianxia'],
      variants: [
        { stage: 'youth', prompt: 'youth prompt', isPrimary: true, sourceChapters: '1-10' },
      ],
      outfitVariants: [
        { scene: '日常', description: '青色劲装', prompt: 'outfit prompt' },
      ],
    });

    expect(drafts.map((d) => d.variantKey)).toEqual(['primary', 'age:youth', 'outfit:日常']);
    expect(drafts[0]).toMatchObject({
      bookId: 'book-1',
      entityName: '萧炎',
      prompt: 'primary prompt',
      promptSource: 'llm-polished',
    });
    expect(drafts[2].variantKey).toBe(outfitVariantKey('日常', '青色劲装'));
  });

  it('uses description prefix as outfit key when scene is missing', () => {
    expect(outfitVariantKey(undefined, '宽大黑袍与大黑斗篷，遮掩面容')).toBe(
      `outfit:${slugOutfitKey('宽大黑袍与大黑斗篷，遮掩面容')}`,
    );
  });

  it('skips unknown entity types and empty prompts', () => {
    expect(expandPromptToDrafts('book-1', { entityName: '灵气', entityType: 'worldview', prompt: 'x' })).toEqual([]);
    expect(expandPromptToDrafts('book-1', { entityName: '萧炎', entityType: 'character' })).toEqual([]);
  });

  it('collects prompts from a pipeline result and expands them', () => {
    const drafts = buildVisualSpecDrafts('book-1', collectPromptsFromResult({
      characterPrompts: [{ entityName: '萧炎', entityType: 'character', prompt: 'c' }],
      itemPrompts: [{ entityName: '古戒', entityType: 'item', prompt: 'i' }],
      locationPrompts: [{ entityName: '乌坦城', entityType: 'location', prompt: 'l' }],
    }));
    expect(drafts).toHaveLength(3);
    expect(drafts.map((d) => d.entityType).sort()).toEqual(['character', 'item', 'location']);
  });

  it('picks outfit / age / primary specs with the same matching rules as image gen', () => {
    const specs = [
      { variantKey: 'primary', prompt: 'main', payload: { kind: 'primary' } },
      { variantKey: ageVariantKey('youth'), prompt: 'young', payload: { kind: 'age', stage: 'youth' } },
      { variantKey: outfitVariantKey('伪装炼药师'), prompt: 'disguise', payload: { kind: 'outfit', scene: '伪装炼药师', description: '宽大黑袍' } },
      { variantKey: outfitVariantKey(undefined, '青色劲装袖口绣有暗纹'), prompt: 'daily', payload: { kind: 'outfit', scene: null, description: '青色劲装袖口绣有暗纹' } },
    ];

    expect(pickActiveSpec(specs)?.prompt).toBe('main');
    expect(pickActiveSpec(specs, { stage: 'youth' })?.prompt).toBe('young');
    expect(pickActiveSpec(specs, { outfit: '伪装炼药师' })?.prompt).toBe('disguise');
    expect(pickActiveSpec(specs, { outfit: '青色劲装袖口绣有暗纹'.slice(0, 20) })?.prompt).toBe('daily');
    expect(pickActiveSpec(specs, { outfit: '不存在' })).toBeNull();
  });
});
