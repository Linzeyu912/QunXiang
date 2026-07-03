import { describe, expect, it } from 'vitest';
import { resolve } from './resolver.js';
import type { Character, Outfit } from './types.js';

type CharacterInput = Omit<Character, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>;

function makeChar(name: string, aliases: string[] = [], confidence = 0.9, outfits: Outfit[] = []): CharacterInput {
  return {
    name,
    aliases,
    description: undefined,
    confidence,
    status: 'PENDING',
    chapterAppearances: [],
    mentionCount: 0,
    dialogueCount: 0,
    coCharacters: [],
    outfits,
  };
}

describe('resolve', () => {
  it('merges characters with the same name (case-insensitive), keeping higher confidence', () => {
    const result = resolve([makeChar('萧炎', [], 0.9), makeChar('萧炎', [], 0.95)]);
    expect(result.characters).toHaveLength(1);
    expect(result.characters[0].confidence).toBe(0.95);
    expect(result.merged).toBe(1);
  });

  it('merges when one character name is another character alias (regression: previously ignored by the mergedInto=nameKey bug)', () => {
    const result = resolve([
      makeChar('药老', ['老师', '老者'], 0.9),
      makeChar('老者', [], 0.8),
    ]);
    expect(result.characters).toHaveLength(1);
    expect(result.characters[0].name).toBe('药老');
    expect(result.merged).toBe(1);
  });

  it('merges Chinese address forms (萧炎哥 → 萧炎)', () => {
    const result = resolve([
      makeChar('萧炎', ['炎儿'], 0.95),
      makeChar('萧炎哥', [], 0.88),
    ]);
    expect(result.characters).toHaveLength(1);
    expect(result.characters[0].name).toBe('萧炎');
    expect(result.merged).toBe(1);
  });

  it('does not merge distinct names', () => {
    const result = resolve([makeChar('萧炎'), makeChar('萧战')]);
    expect(result.characters).toHaveLength(2);
    expect(result.merged).toBe(0);
  });

  it('does not merge distinct proper names when one LLM alias accidentally names the other character', () => {
    const result = resolve([
      makeChar('萧炎', ['萧薰儿', '萧熏儿', '薰儿'], 0.99),
      makeChar('萧薰儿', ['萧熏儿', '薰儿', '熏儿'], 0.95),
    ]);

    expect(result.characters.map((c) => c.name).sort()).toEqual(['萧炎', '萧薰儿']);
    expect(result.merged).toBe(0);
  });

  it('does not merge different families that share a generic role title alias', () => {
    const result = resolve([
      makeChar('萧鹰', ['二长老', '萧鹰二长老', '加列怒'], 0.9),
      makeChar('加列怒', ['二长老', '加列怒长老'], 0.88),
    ]);

    expect(result.characters.map((c) => c.name).sort()).toEqual(['加列怒', '萧鹰']);
    expect(result.merged).toBe(0);
  });

  it('still merges variant spellings and short nicknames for the same character', () => {
    const result = resolve([
      makeChar('萧薰儿', ['薰儿'], 0.95),
      makeChar('萧熏儿', ['熏儿'], 0.9),
      makeChar('薰儿', [], 0.85),
    ]);

    expect(result.characters).toHaveLength(1);
    expect(result.characters[0].name).toBe('萧薰儿');
    expect(result.merged).toBe(2);
  });

  it('promotes a short nickname primary name to a full proper alias', () => {
    const result = resolve([
      makeChar('薰儿', ['薰儿小姐', '熏儿', '萧熏儿', '萧薰儿'], 0.98),
    ]);

    expect(result.characters).toHaveLength(1);
    expect(result.characters[0].name).toBe('萧熏儿');
    expect(result.characters[0].aliases).toContain('薰儿');
    expect(result.characters[0].aliases).toContain('熏儿');
  });

  it('preserves structured outfits through resolution', () => {
    const outfits: Outfit[] = [
      { description: '青色劲装', scene: '日常', firstChapter: 1, lastChapter: 50 },
      { description: '宽大黑袍', scene: '伪装炼药师', firstChapter: 20, lastChapter: 75 },
    ];
    const result = resolve([makeChar('萧炎', ['炎儿'], 0.95, outfits)]);
    expect(result.characters).toHaveLength(1);
    expect(result.characters[0].outfits).toEqual(outfits);
  });

  it('unions outfits (by scene/description) when merging duplicate characters across alias forms', () => {
    const result = resolve([
      makeChar('萧炎', ['炎儿'], 0.95, [
        { description: '青色劲装', scene: '日常', firstChapter: 1, lastChapter: 50 },
      ]),
      makeChar('萧炎哥', [], 0.8, [
        { description: '青色劲装', scene: '日常', firstChapter: 30, lastChapter: 100 },
        { description: '宽大黑袍', scene: '伪装炼药师', firstChapter: 20, lastChapter: 40 },
      ]),
    ]);

    expect(result.characters).toHaveLength(1);
    const outfits = result.characters[0].outfits;
    // '青色劲装' merged by scene → chapter range unioned to 1-100; '宽大黑袍' appended.
    expect(outfits).toHaveLength(2);
    const everyday = outfits.find((o) => o.scene === '日常')!;
    expect(everyday.firstChapter).toBe(1);
    expect(everyday.lastChapter).toBe(100);
    expect(outfits.some((o) => o.description === '宽大黑袍')).toBe(true);
  });
});
