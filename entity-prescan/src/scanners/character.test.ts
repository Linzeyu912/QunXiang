import { describe, expect, it } from 'vitest';
import { scanFrequentCharacterEntities } from './character.js';
import type { ScanChapter } from '../types.js';

describe('scanFrequentCharacterEntities', () => {
  it('keeps frequently mentioned character names while ignoring common surname-starting phrases', () => {
    const xuQiAn = '\u8bb8\u4e03\u5b89';
    const liYuChun = '\u674e\u7389\u6625';
    const xuDuo = '\u8bb8\u591a';
    const chapters: ScanChapter[] = [
      {
        index: 0,
        content: `${xuQiAn}\u8bf4\u9053\u3002${xuQiAn}\u770b\u5411${liYuChun}\u3002${xuDuo}\u4eba\u90fd\u5728\u3002`,
      },
      {
        index: 1,
        content: `${liYuChun}\u95ee${xuQiAn}\u3002${xuQiAn}\u70b9\u5934\u3002${xuQiAn}\u8d70\u6765\u3002${xuQiAn}\u79bb\u5f00\u3002`,
      },
    ];

    const mentions = scanFrequentCharacterEntities(chapters, { minMentions: 2 });
    const names = new Set(mentions.map((m) => m.text));
    const xuMention = mentions.find((m) => m.text === xuQiAn);

    expect(names).toContain(xuQiAn);
    expect(xuMention?.totalCount).toBe(6);
    expect(names).not.toContain(xuDuo);
  });
});
