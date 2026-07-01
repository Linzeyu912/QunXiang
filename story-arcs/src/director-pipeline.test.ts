import { mkdtemp, readFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { describe, expect, it } from 'vitest';
import { runDirectorPipelineForStory } from './director-pipeline.js';
import type { StoryAssetBundle, StorySegment } from './types.js';

function story(): StorySegment {
  return {
    id: 'story-1',
    bookId: 'book-1',
    startChapter: 1,
    endChapter: 3,
    title: '退婚冲突',
    sourceText: '萧炎被退婚羞辱，纳兰嫣然站在萧家大厅中。萧炎写下休书，药老在戒指中苏醒。',
    summary: '萧炎在退婚羞辱中守住尊严，并打开新的修炼道路。',
    coreConflict: '萧炎必须在退婚羞辱中夺回主动权。',
    trigger: '纳兰嫣然提出退婚',
    turningPoints: ['退婚当众提出', '萧炎写下休书', '药老苏醒'],
    conflictStatus: 'ongoing',
    mainCharacters: ['萧炎'],
    supportingCharacters: ['纳兰嫣然', '药老'],
    locations: ['萧家大厅'],
    boundaryConfidence: 0.9,
    boundaryDecisionIds: ['b-1'],
    approved: true,
  };
}

function bundle(storySegment = story()): StoryAssetBundle {
  return {
    story: storySegment,
    characters: {
      storyId: storySegment.id,
      bookId: storySegment.bookId,
      characters: [
        {
          name: '萧炎',
          aliases: [],
          roleInStory: 'protagonist',
          motivation: storySegment.coreConflict,
          conflictRelation: '萧炎承受退婚冲突。',
          firstMentionChapter: 1,
          lastMentionChapter: 3,
          keyActions: ['萧炎写下休书'],
          confidence: 0.9,
          assetStatus: 'confirmed',
          description: '萧炎是退婚冲突中的主角。',
          descriptionQuality: 'sufficient',
          needsDescriptionRepair: false,
          appearanceDescription: '萧炎脸庞带着倔强。',
          appearanceEvidenceSnippets: ['萧炎脸庞带着倔强。'],
          needsAppearanceRepair: false,
          visualPrompt: '萧炎，脸庞带着倔强，身份一致',
          evidenceSnippets: ['萧炎写下休书'],
          sourceChapters: [1, 2, 3],
          sourceRangeHint: 'chapters 1-3',
        },
        {
          name: '纳兰嫣然',
          aliases: [],
          roleInStory: 'supporting',
          motivation: '提出退婚。',
          conflictRelation: '纳兰嫣然触发退婚冲突。',
          firstMentionChapter: 1,
          lastMentionChapter: 3,
          keyActions: ['纳兰嫣然提出退婚'],
          confidence: 0.78,
          assetStatus: 'confirmed',
          description: '纳兰嫣然提出退婚。',
          descriptionQuality: 'sufficient',
          needsDescriptionRepair: false,
          appearanceDescription: '',
          appearanceEvidenceSnippets: [],
          needsAppearanceRepair: true,
          visualPrompt: '纳兰嫣然，appearance not source-confirmed',
          evidenceSnippets: ['纳兰嫣然站在萧家大厅中'],
          sourceChapters: [1, 2, 3],
          sourceRangeHint: 'chapters 1-3',
        },
      ],
    },
    scenes: {
      storyId: storySegment.id,
      bookId: storySegment.bookId,
      scenes: [
        {
          id: 'story-1-scene-1',
          name: '退婚冲突 - 萧家大厅',
          location: '萧家大厅',
          sourceRange: 'chapters 1-3',
          summary: storySegment.summary,
          conflictBeat: storySegment.coreConflict,
          involvedCharacters: ['萧炎', '纳兰嫣然'],
          confidence: 0.82,
          assetStatus: 'confirmed',
          description: '萧家大厅中的退婚冲突。',
          descriptionQuality: 'sufficient',
          needsDescriptionRepair: false,
          visualPrompt: '萧家大厅，家族冲突，压抑气氛',
          evidenceSnippets: ['纳兰嫣然站在萧家大厅中'],
          sourceChapters: [1, 2, 3],
          sourceRangeHint: 'chapters 1-3',
        },
      ],
    },
    props: {
      storyId: storySegment.id,
      bookId: storySegment.bookId,
      props: [
        {
          name: '戒指',
          aliases: [],
          propType: 'token',
          storyFunction: '药老苏醒的载体。',
          firstAppearance: 'chapters 1-3',
          keyMoments: ['药老在戒指中苏醒'],
          confidence: 0.8,
          assetStatus: 'confirmed',
          description: '戒指承载药老。',
          descriptionQuality: 'sufficient',
          needsDescriptionRepair: false,
          visualPrompt: '古朴戒指，关键道具',
          evidenceSnippets: ['药老在戒指中苏醒'],
          sourceChapters: [1, 2, 3],
          sourceRangeHint: 'chapters 1-3',
        },
      ],
    },
    assetPack: {
      storyId: storySegment.id,
      bookId: storySegment.bookId,
      characters: [],
      scenes: [],
      props: [],
      assetWarnings: [],
    },
  };
}

describe('director pipeline agents', () => {
  it('writes episode, script, review, storyboard, and video prompt outputs for one story', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'director-pipeline-'));
    const storyBundle = bundle();
    storyBundle.assetPack.characters = storyBundle.characters.characters;
    storyBundle.assetPack.scenes = storyBundle.scenes.scenes;
    storyBundle.assetPack.props = storyBundle.props.props;

    try {
      const result = await runDirectorPipelineForStory(storyBundle, { outputDir });

      expect(result.assignment.storyIds).toEqual(['story-1']);
      expect(result.episodePlans).toHaveLength(1);
      expect(result.scriptEpisodes[0].scenes.length).toBeGreaterThan(0);
      expect(result.scriptReview.accepted).toBe(true);
      expect(result.storyboardPromptPacks[0].frames.length).toBeGreaterThanOrEqual(4);
      expect(result.storyboardPromptPacks[0].productionBoardPrompt).toContain('16:9');
      expect(result.videoPromptPacks[0].clips.length).toBeGreaterThan(0);

      const base = join(outputDir, 'book-1', 'stories', 'story-1', 'director');
      const episodePlan = JSON.parse(await readFile(join(base, 'episode-plan.json'), 'utf-8'));
      const scripts = JSON.parse(await readFile(join(base, 'script-episodes.json'), 'utf-8'));
      const review = JSON.parse(await readFile(join(base, 'script-review.json'), 'utf-8'));
      const storyboard = JSON.parse(await readFile(join(base, 'storyboard-prompt-pack.json'), 'utf-8'));
      const video = JSON.parse(await readFile(join(base, 'video-prompt-pack.json'), 'utf-8'));

      expect(episodePlan.plans[0].segmentId).toBe('story-1');
      expect(scripts.episodes[0].segmentId).toBe('story-1');
      expect(review.accepted).toBe(true);
      expect(storyboard.frames[0].sourceReferences.length).toBeGreaterThan(0);
      expect(video.clips[0].sourceFrameNos.length).toBeGreaterThan(0);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });
});
