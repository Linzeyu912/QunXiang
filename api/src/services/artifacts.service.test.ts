import { describe, expect, it } from 'vitest';
import { parsePrescanEntityFile, parsePrescanImportanceReport } from './artifacts.service.js';

describe('prescan artifact parsing', () => {
  it('parses chapter-scoped entity mention files', () => {
    const rows = parsePrescanEntityFile('1|萧炎|regex|0.95\n5|葛叶提出退婚请求|llm|0.84\n');

    expect(rows).toEqual([
      { chapterIndex: 1, text: '萧炎', source: 'regex', confidence: 0.95 },
      { chapterIndex: 5, text: '葛叶提出退婚请求', source: 'llm', confidence: 0.84 },
    ]);
  });

  it('parses importance sections and keeps scored rows separate from summary lines', () => {
    const report = parsePrescanImportanceReport(
      [
        '# 实体重要性分析报告',
        '=== CHARACTER (2条) ===',
        '实体|重要性|置信度|分层|分流|因果|唯一|转折|storyScore|storyValue|呈现价值|提及|章节',
        '萧炎|0.531|0.978|supporting|main|1|0|1|2|0.33|1.00|317|1,2,3',
        '[分层统计] core=0 supporting=1 candidate=0 archived=0',
        '=== ITEM (1条) ===',
        '聚气散|0.612|0.822|supporting|main|2|1|0|3|0.50|0.85|6|5,6',
      ].join('\n'),
    );

    expect(report.sections).toHaveLength(2);
    expect(report.sections[0].type).toBe('character');
    expect(report.sections[0].rows[0]).toMatchObject({
      text: '萧炎',
      importance: 0.531,
      confidence: 0.978,
      tier: 'supporting',
      route: 'main',
      chapters: [1, 2, 3],
    });
    expect(report.sections[1].type).toBe('item');
    expect(report.sections[1].rows[0].mentionCount).toBe(6);
    expect(report.rawPreview).toContain('实体重要性分析报告');
  });
});
