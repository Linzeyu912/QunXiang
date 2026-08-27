import { describe, expect, it } from 'vitest';
import { splitChapters, splitChaptersStructured, normalizeBookTitleForMatch } from './chapter-splitter.js';

describe('章节识别修复（实施包 C2）', () => {
  it('首行与书名相同且后续存在正式章节时，不单独建立章节', () => {
    const text = ['斗破苍穹', '这里是简介。', '第一章 陨落的天才', '萧炎望着石碑。', '第二章 斗气大陆', '萧炎继续前行。'].join('\n');
    const result = splitChapters(text, { bookTitle: '斗破苍穹' });
    expect(result.chapters.length).toBe(2);
    expect(result.chapters[0].title).toBe('陨落的天才');
    // 书名行与简介并入第一章开头，内容不丢失
    expect(result.chapters[0].content).toContain('这里是简介');
  });

  it('文件名中的章节数不参与书名比对（斗破苍穹150章.txt）', () => {
    const text = ['斗破苍穹', '第一章 陨落的天才', '正文。', '第二章 斗气大陆', '正文二。'].join('\n');
    expect(normalizeBookTitleForMatch('斗破苍穹150章')).toBe('斗破苍穹');
    const result = splitChapters(text, { bookTitle: '斗破苍穹150章' });
    expect(result.chapters.length).toBe(2);
    expect(result.chapters[0].content).toContain('第一章 陨落的天才');
  });

  it('前言、序章、楔子、后记正常保留为章节', () => {
    const text = ['前言', '写在故事开始之前。', '第一章 起点', '正文一。', '后记', '写在故事结束之后。'].join('\n');
    const result = splitChapters(text, { bookTitle: '某书' });
    const titles = result.chapters.map((c) => c.title);
    expect(titles).toContain('前言');
    expect(titles).toContain('后记');
  });

  it('无标题文本可选择整本一章（fallbackMode=whole-book）', () => {
    const text = '这是一段没有任何章节标记的长文本。\n第二行内容。\n第三行内容。';
    const byLength = splitChapters(text, { bookTitle: '无题' });
    expect(byLength.isFallback).toBe(true);

    const whole = splitChapters(text, { bookTitle: '无题', fallbackMode: 'whole-book' });
    expect(whole.chapters).toHaveLength(1);
    expect(whole.matchedMode).toBe('whole-book');
    expect(whole.chapters[0].content).toContain('第三行内容');
  });

  it('结构化切分同样应用书名行规则', () => {
    const text = ['斗破苍穹', '简介一行。', '第一章 陨落的天才', '正文。', '第二章 继续', '正文二。'].join('\n');
    const structure = splitChaptersStructured(text, { bookTitle: '斗破苍穹' });
    expect(structure.flatList.length).toBe(2);
    expect(structure.flatList[0].content).toContain('第一章 陨落的天才');
  });

  it('只有书名行、无后续章节时不误删（单块保留）', () => {
    const text = '斗破苍穹\n只有一段内容没有章节标记。';
    const result = splitChapters(text, { bookTitle: '斗破苍穹' });
    expect(result.chapters).toHaveLength(1);
  });
});
