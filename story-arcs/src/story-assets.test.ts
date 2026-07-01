import { mkdtemp, readFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { describe, expect, it } from 'vitest';
import { extractAssetsForStories } from './story-assets.js';
import type { StorySegment } from './types.js';

describe('story asset agents', () => {
  it('extracts characters, scenes, and props into one folder per story', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'story-assets-'));
    const stories: StorySegment[] = [{
      id: 'story-1',
      bookId: 'book-1',
      startChapter: 1,
      endChapter: 3,
      title: '牢狱自救',
      sourceText: [
        '许七安被关在牢房里，怀里藏着一块铜牌。',
        '夜晚，牢房外火把摇晃，狱卒逼近。',
        '许七安握紧铜牌，低声对采薇说出自己的计划。',
      ].join('\n'),
      summary: '许七安在牢房中尝试自救。',
      coreConflict: '许七安必须在狱卒逼近前找到脱身办法。',
      trigger: '许七安被关押。',
      turningPoints: ['狱卒逼近', '铜牌成为关键线索'],
      conflictStatus: 'partially_resolved',
      mainCharacters: ['许七安'],
      supportingCharacters: ['采薇'],
      locations: ['牢房'],
      boundaryConfidence: 0.95,
      boundaryDecisionIds: ['b-1'],
      approved: true,
    }];

    try {
      const result = await extractAssetsForStories(stories, { outputDir });

      expect(result.storyAssets).toHaveLength(1);
      expect(result.storyAssets[0].characters.characters.map((c) => c.name)).toContain('许七安');
      expect(result.storyAssets[0].characters.characters.map((c) => c.name)).toContain('采薇');
      expect(result.storyAssets[0].scenes.scenes[0].location).toContain('牢房');
      expect(result.storyAssets[0].props.props.map((p) => p.name)).toContain('铜牌');

      const base = join(outputDir, 'book-1', 'stories', 'story-1');
      const characters = JSON.parse(await readFile(join(base, 'characters.json'), 'utf-8'));
      const scenes = JSON.parse(await readFile(join(base, 'scenes.json'), 'utf-8'));
      const props = JSON.parse(await readFile(join(base, 'props.json'), 'utf-8'));
      const pack = JSON.parse(await readFile(join(base, 'asset-pack.json'), 'utf-8'));
      const characterPrompts = JSON.parse(await readFile(join(base, 'character-prompts.json'), 'utf-8'));
      const scenePrompts = JSON.parse(await readFile(join(base, 'scene-prompts.json'), 'utf-8'));
      const propPrompts = JSON.parse(await readFile(join(base, 'prop-prompts.json'), 'utf-8'));
      const assetPrompts = JSON.parse(await readFile(join(base, 'asset-prompts.json'), 'utf-8'));

      expect(characters.storyId).toBe('story-1');
      expect(scenes.storyId).toBe('story-1');
      expect(props.storyId).toBe('story-1');
      expect(pack.storyId).toBe('story-1');
      expect(pack.characters.length).toBeGreaterThan(0);
      expect(pack.scenes.length).toBeGreaterThan(0);
      expect(pack.props.length).toBeGreaterThan(0);
      expect(characterPrompts.prompts[0].assetType).toBe('character');
      expect(characterPrompts.prompts[0].prompt).toContain('许七安');
      expect(scenePrompts.prompts[0].assetType).toBe('scene');
      expect(propPrompts.prompts[0].assetType).toBe('prop');
      expect(assetPrompts.allPrompts.length).toBe(
        characterPrompts.prompts.length + scenePrompts.prompts.length + propPrompts.prompts.length
      );
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it('skips unapproved story segments so downstream agents only see approved stories', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'story-assets-'));
    const stories: StorySegment[] = [{
      id: 'story-review',
      bookId: 'book-1',
      startChapter: 4,
      endChapter: 4,
      title: '待确认边界',
      sourceText: '李妙真走入山谷。',
      summary: '待确认故事。',
      coreConflict: '边界未确认。',
      trigger: '未知。',
      turningPoints: [],
      conflictStatus: 'ongoing',
      mainCharacters: ['李妙真'],
      supportingCharacters: [],
      locations: ['山谷'],
      boundaryConfidence: 0.5,
      boundaryDecisionIds: ['b-review'],
      approved: false,
    }];

    try {
      const result = await extractAssetsForStories(stories, { outputDir });
      expect(result.storyAssets).toEqual([]);
      expect(result.skippedStoryIds).toEqual(['story-review']);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });
});
