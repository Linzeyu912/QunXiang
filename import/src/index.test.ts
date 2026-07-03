import { describe, expect, it } from 'vitest';
import { parseChapterOutline, parseTxtEnhanced } from './index.js';

describe('@novel-agent/import runtime exports', () => {
  it('exports enhanced TXT parsing from the JavaScript runtime entrypoint', () => {
    expect(parseTxtEnhanced).toEqual(expect.any(Function));
  });

  it('marks whether each detected noise line is actually removed by conservative preprocessing', () => {
    const outline = parseChapterOutline(
      [
        '第1章 开始',
        '正文第一段。',
        '关注公众号继续阅读',
        '甲',
        '',
        '',
        '第2章 继续',
        '正文第二段。',
        '',
        '',
        '第3章 发展',
        '正文第三段。',
        '',
        '',
        '第4章 结束',
        '正文第四段。',
      ].join('\n'),
      '测试.txt',
    );

    const promo = outline.suspectLines.find((line) => line.category === 'promo');
    const retainedMeta = outline.suspectLines.find((line) => line.category === 'meta' && line.confidence < 0.8);

    expect(promo).toMatchObject({ content: '关注公众号继续阅读', confidence: 0.85, removed: true });
    expect(retainedMeta).toMatchObject({ content: '甲', confidence: 0.6, removed: false });
    expect(outline.removedNoiseLines).toBe(1);
  });
});
