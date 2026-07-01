import { describe, expect, it } from 'vitest';
import { buildNarrativeArcsFromEvents, extractNarrativeEvents } from './narrative-events.js';
import type { ParseResult, PrescanResult } from '@novel-agent/import';

const parseResult: ParseResult = {
  title: '斗破苍穹 1-10',
  fullText: '',
  chapters: [
    { index: 4, title: '客人', content: '纳兰嫣然和葛叶来到萧家，云岚宗逼近。' },
    { index: 5, title: '聚气散', content: '葛叶请求萧战解除婚约。葛叶拿出聚气散作为赔礼。萧炎面对羞辱。' },
    { index: 6, title: '休书', content: '萧炎写下休书，拒绝退婚羞辱。萧炎与纳兰嫣然立下三年之约。' },
    { index: 9, title: '药老', content: '药老从戒指中现身，萧炎发现戒指秘密。' },
  ],
};

const prescanResult: PrescanResult = {
  character: [
    { text: '萧炎', chapterIndex: 5, position: 0, source: 'regex', confidence: 0.95 },
    { text: '萧战', chapterIndex: 5, position: 0, source: 'regex', confidence: 0.9 },
    { text: '纳兰嫣然', chapterIndex: 4, position: 0, source: 'regex', confidence: 0.86 },
    { text: '葛叶', chapterIndex: 4, position: 0, source: 'regex', confidence: 0.82 },
    { text: '药老', chapterIndex: 9, position: 0, source: 'regex', confidence: 0.84 },
  ],
  location: [],
  item: [
    { text: '聚气散', chapterIndex: 5, position: 0, source: 'regex', confidence: 0.8 },
    { text: '戒指', chapterIndex: 9, position: 0, source: 'regex', confidence: 0.8 },
  ],
  event: [
    { text: '葛叶请求解除婚约', chapterIndex: 5, position: 0, source: 'regex', confidence: 0.86 },
    { text: '葛叶拿出聚气散', chapterIndex: 5, position: 12, source: 'regex', confidence: 0.84 },
    { text: '萧炎写下休书', chapterIndex: 6, position: 0, source: 'regex', confidence: 0.86 },
    { text: '萧炎立下三年之约', chapterIndex: 6, position: 16, source: 'regex', confidence: 0.88 },
    { text: '药老从戒指中现身', chapterIndex: 9, position: 0, source: 'regex', confidence: 0.85 },
  ],
  stats: {
    character: { regexCount: 5, llmCount: 0, afterDedup: 5 },
    location: { regexCount: 0, llmCount: 0, afterDedup: 0 },
    item: { regexCount: 2, llmCount: 0, afterDedup: 2 },
    event: { regexCount: 5, llmCount: 0, afterDedup: 5 },
    durationMs: 1,
  },
};

describe('narrative events and arcs', () => {
  it('turns prescan event mentions into structured narrative events with evidence', () => {
    const events = extractNarrativeEvents(parseResult, prescanResult);

    expect(events.map((event) => event.summary)).toEqual([
      '葛叶请求解除婚约',
      '葛叶拿出聚气散',
      '萧炎写下休书',
      '萧炎立下三年之约',
      '药老从戒指中现身',
    ]);
    expect(events[0]).toMatchObject({
      chapterIndex: 5,
      eventType: 'conflict',
      function: 'inciting',
      participants: expect.arrayContaining(['葛叶', '萧战']),
    });
    expect(events[0].evidenceSnippet).toContain('解除婚约');
  });

  it('groups adjacent events into durable arcs for script agents', () => {
    const events = extractNarrativeEvents(parseResult, prescanResult);
    const arcs = buildNarrativeArcsFromEvents('book-1', events);

    expect(arcs).toHaveLength(2);
    expect(arcs[0]).toMatchObject({
      title: '退婚冲突',
      startChapter: 5,
      endChapter: 6,
      arcType: 'conflict',
      coreConflict: '葛叶请求解除婚约',
    });
    expect(arcs[0].events.map((event) => event.summary)).toEqual([
      '葛叶请求解除婚约',
      '葛叶拿出聚气散',
      '萧炎写下休书',
      '萧炎立下三年之约',
    ]);
    expect(arcs[1]).toMatchObject({
      title: '戒指秘密',
      startChapter: 9,
      endChapter: 9,
      arcType: 'reveal',
    });
  });
}
);
