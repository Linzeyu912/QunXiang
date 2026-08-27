import { describe, expect, it } from 'vitest';
import { detectNoise, cleanText } from './filter.js';

function suspectsOf(text: string) {
  return detectNoise(text).suspectLines;
}

describe('保守噪声策略（实施包 C3）', () => {
  it('网址/推广/模板仍自动排除', () => {
    const lines = ['https://example.com 阅读更多', '加入书友群 123456 聊天', '本书由XX网整理提供'];
    const text = lines.join('\n');
    const suspects = suspectsOf(text);
    const removed = cleanText(text, detectNoise(text), 'conservative');
    expect(removed.trim().length).toBe(0);
    expect(suspects.length).toBeGreaterThanOrEqual(3);
  });

  it('确定性重复页眉页脚自动排除（≥50% 小节出现）', () => {
    const header = '——本站独家连载——';
    const sections: string[] = [];
    for (let i = 1; i <= 6; i++) {
      sections.push(`第${i}章\n${header}\n正文内容第${i}章。`);
    }
    // 4+ 个小节、每个小节尾 5 行内重复出现 → 确定性页眉页脚
    const text = sections.join('\n\n\n');
    const cleaned = cleanText(text, detectNoise(text), 'conservative');
    expect(cleaned).not.toContain(header);
  });

  it('省略号对白与拟声词只标记不删除', () => {
    const text = ['萧炎说道。', '"……"', '哈哈哈！', '正文继续。'].join('\n');
    const report = detectNoise(text);
    const cats = report.suspectLines.map((s) => s.category);
    expect(cats).toContain('dialogue');
    expect(cats).toContain('onomatopoeia');
    const cleaned = cleanText(text, report, 'conservative');
    expect(cleaned).toContain('"……"');
    expect(cleaned).toContain('哈哈哈');
  });

  it('超短句只标记不删除', () => {
    const text = ['正常的一行正文。', '嗯。', '好。'].join('\n');
    const report = detectNoise(text);
    expect(report.suspectLines.some((s) => s.category === 'short')).toBe(true);
    const cleaned = cleanText(text, report, 'conservative');
    expect(cleaned).toContain('嗯。');
  });

  it('含中文的疑似乱码行只标记，纯符号乱码行自动删除', () => {
    const cjkGarbled = '¤§中¤§文¤§¤¤'; // 符号为主但夹带 CJK 正文特征
    const symbolGarbled = '¤§¤§¤§¤¤¤§¤§¤¤§¤¤¤'; // 无 CJK 纯符号
    const text = ['正文。', cjkGarbled, symbolGarbled, '更多正文。'].join('\n');
    const report = detectNoise(text);
    const cjkLine = report.suspectLines.find((s) => s.content === cjkGarbled);
    expect(cjkLine?.confidence ?? 1).toBeLessThan(0.8);
    const cleaned = cleanText(text, report, 'conservative');
    expect(cleaned).toContain(cjkGarbled);
    expect(cleaned).not.toContain(symbolGarbled);
  });
});
