import { describe, expect, it } from 'vitest';
import {
  characterSchema,
  extractionResultSchema,
  itemSchema,
  locationSchema,
} from './index.js';

describe('@novel-agent/schemas runtime exports', () => {
  it('exports extraction, item, and location schemas from the JavaScript runtime entrypoint', () => {
    expect(extractionResultSchema).toEqual(expect.objectContaining({ parse: expect.any(Function) }));
    expect(itemSchema).toEqual(expect.objectContaining({ parse: expect.any(Function) }));
    expect(locationSchema).toEqual(expect.objectContaining({ parse: expect.any(Function) }));
  });

  it('defaults outfits on a character and owners on an item to empty arrays', () => {
    const char = characterSchema.parse({ name: '萧炎' });
    expect(char.outfits).toEqual([]);

    const item = itemSchema.parse({ name: '黑色古戒' });
    expect(item.owners).toEqual([]);
  });

  it('parses structured outfits (character) and owners (item) with chapter ranges', () => {
    const char = characterSchema.parse({
      name: '萧炎',
      outfits: [
        { description: '青色劲装', scene: '日常', firstChapter: 1, lastChapter: 100 },
        { description: '宽大黑袍', scene: '伪装炼药师', firstChapter: 20, lastChapter: 75 },
      ],
    });
    expect(char.outfits).toHaveLength(2);
    expect(char.outfits[0]).toMatchObject({ description: '青色劲装', scene: '日常' });

    const item = itemSchema.parse({
      name: '黑色古戒',
      owners: [
        { name: '萧炎母亲', note: '遗物' },
        { name: '萧炎', firstChapter: 1, lastChapter: 100, note: '佩戴' },
      ],
    });
    expect(item.owners).toHaveLength(2);
    expect(item.owners[1]).toMatchObject({ name: '萧炎', firstChapter: 1, lastChapter: 100 });
  });
});
