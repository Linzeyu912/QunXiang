import { describe, expect, it } from 'vitest';
import { extractStoryProps } from './story-prop-agent.js';
import type { StorySegment } from './types.js';

describe('extractStoryProps', () => {
  it('keeps concrete prop names and ignores generic craft/action phrases', () => {
    const story: StorySegment = {
      id: 'story-props',
      bookId: 'book-1',
      startChapter: 1,
      endChapter: 2,
      title: '炼药起点',
      sourceText: '萧炎学习炼药，准备炼制丹药。葛叶拔出青木剑，短剑寒光一闪。',
      summary: '萧炎的炼药道路开始。',
      coreConflict: '萧炎必须获得修炼资源。',
      trigger: '药老现身',
      turningPoints: ['青木剑出现', '丹药成为修炼资源'],
      conflictStatus: 'ongoing',
      mainCharacters: ['萧炎'],
      supportingCharacters: ['葛叶'],
      locations: [],
      boundaryConfidence: 0.8,
      boundaryDecisionIds: ['b-1'],
      approved: true,
    };

    const props = extractStoryProps(story).props.map((prop) => prop.name);

    expect(props).toEqual(expect.arrayContaining(['青木剑', '短剑', '丹药']));
    expect(props).not.toContain('炼药');
    expect(props.some((name) => name.endsWith('的药'))).toBe(false);
    expect(props.some((name) => name.includes('的剑'))).toBe(false);
  });
});
