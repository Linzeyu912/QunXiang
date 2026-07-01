import { mkdtemp, readFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { describe, expect, it } from 'vitest';
import { buildStorySegmentsFromParseResult } from './story-segments.js';
import { extractAssetsForStories } from './story-assets.js';
import type { ParseResult, PrescanResult } from '@novel-agent/import';

describe('automatic story segment creation', () => {
  it('groups a short connected chapter run into an approved story segment for story asset agents', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'story-segments-'));
    const parseResult: ParseResult = {
      title: '斗破苍穹 1-10',
      fullText: '',
      chapters: [
        { index: 1, title: '书名：斗破苍穹', content: '书名：斗破苍穹' },
        { index: 2, title: '陨落的天才', content: '萧炎被众人嘲笑，萧战护住萧炎。' },
        { index: 3, title: '斗气大陆', content: '萧炎在乌坦城想起三年前的失败。' },
        { index: 4, title: '客人', content: '纳兰嫣然和葛叶来到萧家，云岚宗逼近。' },
        { index: 5, title: '云岚宗', content: '纳兰嫣然提出退婚，萧炎面对羞辱。青木剑被提起。' },
        { index: 6, title: '聚气散', content: '聚气散让萧家众人震动，萧炎拒绝低头。' },
        { index: 7, title: '炼药师', content: '萧炎想成为炼药师，药老的线索开始出现。' },
        { index: 8, title: '休！', content: '萧炎写下休书，退婚冲突反转。' },
        { index: 9, title: '神秘的老者', content: '神秘的老者现身，萧炎发现戒指秘密。' },
        { index: 10, title: '药老！', content: '药老与萧炎对话，炼药的道路打开。' },
        { index: 11, title: '借钱', content: '萧炎为炼药借钱，新的修炼目标形成。' },
      ],
    };
    const prescanResult: PrescanResult = {
      character: [
        { text: '萧炎', chapterIndex: 2, position: 0, source: 'regex', confidence: 0.95 },
        { text: '萧战', chapterIndex: 2, position: 0, source: 'regex', confidence: 0.9 },
        { text: '纳兰嫣然', chapterIndex: 4, position: 0, source: 'regex', confidence: 0.86 },
        { text: '葛叶', chapterIndex: 4, position: 0, source: 'regex', confidence: 0.82 },
        { text: '药老', chapterIndex: 10, position: 0, source: 'regex', confidence: 0.84 },
      ],
      location: [
        { text: '乌坦城', chapterIndex: 3, position: 0, source: 'regex', confidence: 0.8 },
        { text: '萧家', chapterIndex: 4, position: 0, source: 'regex', confidence: 0.8 },
      ],
      item: [
        { text: '青木剑', chapterIndex: 5, position: 0, source: 'regex', confidence: 0.8 },
      ],
      event: [],
      stats: {
        character: { regexCount: 5, llmCount: 0, afterDedup: 5 },
        location: { regexCount: 2, llmCount: 0, afterDedup: 2 },
        item: { regexCount: 1, llmCount: 0, afterDedup: 1 },
        event: { regexCount: 0, llmCount: 0, afterDedup: 0 },
        durationMs: 1,
      },
    };

    try {
      const stories = buildStorySegmentsFromParseResult(parseResult, {
        bookId: 'doupo-cangqiong-1-10',
        prescanResult,
      });

      expect(stories).toHaveLength(1);
      expect(stories[0]).toMatchObject({
        bookId: 'doupo-cangqiong-1-10',
        startChapter: 2,
        endChapter: 11,
        approved: true,
      });
      expect(stories[0].mainCharacters).toContain('萧炎');
      expect(stories[0].supportingCharacters).toEqual(expect.arrayContaining(['纳兰嫣然', '药老']));
      expect(stories[0].locations).toEqual(expect.arrayContaining(['乌坦城', '萧家']));
      expect(stories[0].turningPoints.length).toBeGreaterThan(0);

      const result = await extractAssetsForStories(stories, { outputDir });
      expect(result.storyAssets).toHaveLength(1);
      expect(result.storyAssets[0].assetPack.characters.map((c) => c.name)).toContain('萧炎');
      expect(result.storyAssets[0].assetPack.scenes.map((s) => s.location)).toContain('乌坦城');
      expect(result.storyAssets[0].assetPack.props.map((p) => p.name)).toContain('青木剑');

      const packPath = join(outputDir, 'doupo-cangqiong-1-10', 'stories', stories[0].id, 'asset-pack.json');
      const pack = JSON.parse(await readFile(packPath, 'utf-8'));
      expect(pack.storyId).toBe(stories[0].id);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it('uses source text as a fallback for character names missed by prescan', () => {
    const parseResult: ParseResult = {
      title: '斗破苍穹 1-10',
      fullText: '',
      chapters: [
        { index: 1, title: '退婚', content: '萧炎面对纳兰嫣然退婚，药老在戒指里苏醒。' },
      ],
    };
    const prescanResult: PrescanResult = {
      character: [
        { text: '萧炎', chapterIndex: 1, position: 0, source: 'regex', confidence: 0.95 },
      ],
      location: [],
      item: [],
      event: [],
      stats: {
        character: { regexCount: 1, llmCount: 0, afterDedup: 1 },
        location: { regexCount: 0, llmCount: 0, afterDedup: 0 },
        item: { regexCount: 0, llmCount: 0, afterDedup: 0 },
        event: { regexCount: 0, llmCount: 0, afterDedup: 0 },
        durationMs: 1,
      },
    };

    const stories = buildStorySegmentsFromParseResult(parseResult, {
      bookId: 'doupo-cangqiong-1-10',
      prescanResult,
    });

    expect(stories[0].mainCharacters).toContain('萧炎');
    expect(stories[0].supportingCharacters).toEqual(expect.arrayContaining(['纳兰嫣然', '药老']));
  });

  it('keeps worldbuilding setup chapters as scriptable arcs beside plot events', () => {
    const parseResult: ParseResult = {
      title: '斗破苍穹 1-10',
      fullText: '',
      chapters: [
        {
          index: 2,
          title: '斗气大陆',
          content:
            '大陆名为斗气大陆，斗气才是大陆的唯一主调。' +
            '斗气大陆将斗气功法的等级，由高到低分为四阶十二级：天、地、玄、黄。' +
            '斗技在大陆之上也有着等级之分。',
        },
        {
          index: 5,
          title: '聚气散',
          content:
            '葛叶站起身来对着萧战拱手，说此次前来主要是有事相求。' +
            '葛叶拿出聚气散，大厅中众人震动。',
        },
        {
          index: 7,
          title: '休',
          content:
            '纳兰嫣然要求解除婚约，萧炎拒绝解除婚约。' +
            '三年之后，萧炎去云岚宗挑战纳兰嫣然。',
        },
        { index: 9, title: '药老', content: '药老从戒指中现身，萧炎发现戒指秘密。' },
      ],
    };
    const prescanResult: PrescanResult = {
      character: [
        { text: '萧炎', chapterIndex: 2, position: 0, source: 'regex', confidence: 0.95 },
        { text: '葛叶', chapterIndex: 5, position: 0, source: 'regex', confidence: 0.84 },
        { text: '纳兰嫣然', chapterIndex: 7, position: 0, source: 'regex', confidence: 0.86 },
        { text: '药老', chapterIndex: 9, position: 0, source: 'regex', confidence: 0.84 },
      ],
      location: [
        { text: '斗气大陆', chapterIndex: 2, position: 0, source: 'regex', confidence: 0.8 },
      ],
      item: [
        { text: '聚气散', chapterIndex: 5, position: 0, source: 'regex', confidence: 0.8 },
        { text: '戒指', chapterIndex: 9, position: 0, source: 'regex', confidence: 0.8 },
      ],
      event: [
        { text: '葛叶提出退婚请求', chapterIndex: 5, position: 0, source: 'regex', confidence: 0.84 },
        { text: '葛叶拿出聚气散', chapterIndex: 5, position: 20, source: 'regex', confidence: 0.84 },
        { text: '萧炎拒绝解除婚约', chapterIndex: 7, position: 0, source: 'regex', confidence: 0.86 },
        { text: '纳兰嫣然要求解除婚约', chapterIndex: 7, position: 10, source: 'regex', confidence: 0.86 },
        { text: '萧炎立下三年之约', chapterIndex: 7, position: 30, source: 'regex', confidence: 0.88 },
        { text: '药老从戒指中现身', chapterIndex: 9, position: 0, source: 'regex', confidence: 0.84 },
      ],
      stats: {
        character: { regexCount: 4, llmCount: 0, afterDedup: 4 },
        location: { regexCount: 1, llmCount: 0, afterDedup: 1 },
        item: { regexCount: 2, llmCount: 0, afterDedup: 2 },
        event: { regexCount: 6, llmCount: 0, afterDedup: 6 },
        durationMs: 1,
      },
    };

    const stories = buildStorySegmentsFromParseResult(parseResult, {
      bookId: 'doupo-cangqiong-1-10',
      prescanResult,
    });

    expect(stories.map((story) => story.title)).toEqual([
      '斗气大陆设定',
      '退婚冲突',
      '戒指秘密',
    ]);
    expect(stories[0]).toMatchObject({
      arcType: 'worldbuilding',
      startChapter: 2,
      endChapter: 2,
    });
    expect(stories[0].turningPoints).toEqual(expect.arrayContaining([
      '斗气大陆修炼体系',
      '斗气功法等级',
    ]));
    expect(stories[1].startChapter).toBe(5);
    expect(stories[1].turningPoints).toEqual(expect.arrayContaining([
      '葛叶提出退婚请求',
      '葛叶拿出聚气散',
      '萧炎立下三年之约',
    ]));
  });
});
