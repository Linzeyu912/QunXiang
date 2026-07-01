import { describe, expect, it } from 'vitest';
import { calcFinalImportance, calcImportance, mapStoryScoreToValue } from './importance.js';
import type { EntityMention, EntityType, ScanChapter } from './types.js';

describe('handover importance formula', () => {
  it('maps pillar sum to storyValue before applying the final formula', () => {
    expect(mapStoryScoreToValue(0)).toBe(0);
    expect(mapStoryScoreToValue(3)).toBe(0.5);
    expect(mapStoryScoreToValue(6)).toBe(1);

    expect(calcFinalImportance(3, 0.4, { storyWeight: 0.7, prodWeight: 0.3 }))
      .toBeCloseTo(0.7 * 0.5 + 0.3 * 0.4, 6);
  });

  it('preserves character aliases for importance report output', () => {
    const chapters: ScanChapter[] = [
      { index: 0, title: '牢狱之灾', content: '许七安说许宁宴就是自己，许七安破案。' },
    ];
    const mention: EntityMention = {
      text: '许七安',
      aliases: ['许宁宴'],
      chapterIndex: 0,
      position: 0,
      source: 'regex',
      confidence: 0.95,
      totalCount: 2,
      allChapters: [0],
    };

    const results = calcImportance(new Map<EntityType, EntityMention[]>([
      ['character', [mention]],
    ]), chapters);

    expect(results.get('character')?.[0].aliases).toEqual(['许宁宴']);
  });
});
