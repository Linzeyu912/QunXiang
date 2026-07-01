import { describe, expect, it } from 'vitest';
import {
  canonicalizeCharacterMentions,
  discoverFullTextCharacterMentions,
} from './role-discovery.js';
import type { EntityMention, ScanChapter } from './types.js';

describe('role discovery integration', () => {
  it('rolls verified aliases into canonical character mentions', () => {
    const chapters: ScanChapter[] = [
      {
        index: 0,
        content: '许七安说道。许宁宴看向李玉春。许宁宴点头。许七安离开。',
      },
      {
        index: 1,
        content: '许宁宴问道。许七安回答。许宁宴沉默。',
      },
    ];

    const result = discoverFullTextCharacterMentions(chapters, { minMentions: 2 });
    const names = result.mentions.map((mention) => mention.text);
    const canonical = result.mentions.find((mention) => mention.text === '许七安');

    expect(result.aliasToPrimary.get('许宁宴')).toBe('许七安');
    expect(names).toContain('许七安');
    expect(names).not.toContain('许宁宴');
    expect(canonical?.totalCount).toBe(7);
    expect(canonical?.allChapters).toEqual([0, 1]);
  });

  it('canonicalizes aliases from other character sources before scoring', () => {
    const mentions: EntityMention[] = [
      { text: '许宁宴', chapterIndex: 0, position: 0, source: 'regex', confidence: 0.9 },
    ];

    const canonicalized = canonicalizeCharacterMentions(mentions, new Map([['许宁宴', '许七安']]));

    expect(canonicalized.map((mention) => mention.text)).toEqual(['许七安']);
  });
});
