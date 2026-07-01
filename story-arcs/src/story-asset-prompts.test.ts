import { describe, expect, it } from 'vitest';
import { buildStoryAssetPromptPack } from './story-asset-prompts.js';
import type { CharacterInStory, PropInStory, SceneInStory, StorySegment } from './types.js';

const story: StorySegment = {
  id: 'story-1',
  bookId: 'book-1',
  startChapter: 1,
  endChapter: 1,
  title: '退婚冲突',
  sourceText: '萧炎脸庞狰狞。',
  summary: '萧炎面对退婚。',
  coreConflict: '萧炎必须承受退婚羞辱。',
  trigger: '退婚',
  turningPoints: ['退婚'],
  conflictStatus: 'ongoing',
  mainCharacters: ['萧炎'],
  supportingCharacters: [],
  locations: ['萧家'],
  boundaryConfidence: 0.9,
  boundaryDecisionIds: ['b-1'],
  approved: true,
};

function character(overrides: Partial<CharacterInStory> = {}): CharacterInStory {
  return {
    name: '萧炎',
    aliases: [],
    roleInStory: 'protagonist',
    motivation: '面对退婚。',
    conflictRelation: '面对退婚。',
    firstMentionChapter: 1,
    lastMentionChapter: 1,
    keyActions: [],
    confidence: 0.9,
    assetStatus: 'confirmed',
    description: '萧炎是本段核心人物。',
    descriptionQuality: 'sufficient',
    needsDescriptionRepair: false,
    appearanceDescription: '脸庞狰狞，脸庞再次回复了平日的落寞',
    appearanceEvidenceSnippets: ['脸庞狰狞'],
    needsAppearanceRepair: false,
    visualPrompt: '旧的角色连续性说明，emotional context: 萧炎必须承受退婚羞辱。',
    evidenceSnippets: ['萧炎脸庞狰狞。'],
    sourceChapters: [1],
    sourceRangeHint: 'chapters 1-1',
    ...overrides,
  };
}

describe('story asset character prompts', () => {
  it('builds character prompts as front side back and face close-up reference sheets', () => {
    const pack = buildStoryAssetPromptPack(story, {
      characters: [character()],
      scenes: [],
      props: [],
    });

    const prompt = pack.characterPrompts[0].prompt;
    expect(prompt).toContain('四视图');
    expect(prompt).toContain('正面');
    expect(prompt).toContain('侧面');
    expect(prompt).toContain('背面');
    expect(prompt).toContain('面部特写');
    expect(prompt).toContain('角色设定拆解：服装/配色、面部/五官、发型、体态/身形、神情/气质、饰物/随身特征逐项呈现');
    expect(prompt).toContain('面部近景清晰');
    expect(prompt).not.toContain('3/4侧面');
    expect(prompt).toContain('脸庞狰狞');
    expect(prompt).not.toContain('emotional context');
    expect(prompt).not.toContain('面对退婚');
  });

  it('builds scene prompts as multi-angle environment reference sheets', () => {
    const scene: SceneInStory = {
      id: 'scene-1',
      name: '萧家大厅',
      location: '萧家大厅',
      timeHint: '白天',
      sourceRange: 'chapters 1-1',
      summary: '萧家大厅里发生退婚冲突。',
      conflictBeat: '退婚冲突爆发。',
      involvedCharacters: ['萧炎', '纳兰嫣然'],
      confidence: 0.82,
      assetStatus: 'confirmed',
      description: '萧家大厅，退婚冲突发生地。',
      descriptionQuality: 'sufficient',
      needsDescriptionRepair: false,
      visualPrompt: '旧的场景连续性说明',
      evidenceSnippets: ['萧家大厅里众人沉默。'],
      sourceChapters: [1],
      sourceRangeHint: 'chapters 1-1',
    };
    const pack = buildStoryAssetPromptPack(story, {
      characters: [],
      scenes: [scene],
      props: [],
    });

    const prompt = pack.scenePrompts[0].prompt;
    expect(prompt).toContain('多方位场景设定图');
    expect(prompt).toContain('入口视角');
    expect(prompt).toContain('反向视角');
    expect(prompt).toContain('俯视布局');
    expect(prompt).toContain('关键细节特写');
    expect(prompt).toContain('萧家大厅');
  });

  it('builds prop prompts as adaptive multi-angle object reference sheets', () => {
    const prop: PropInStory = {
      name: '戒指',
      aliases: [],
      propType: 'other',
      storyFunction: '戒指牵出药老。',
      ownerOrHolder: '萧炎',
      firstAppearance: 'chapters 1-1',
      keyMoments: ['萧炎看向戒指。'],
      confidence: 0.8,
      assetStatus: 'confirmed',
      description: '戒指是关键道具。',
      descriptionQuality: 'sufficient',
      needsDescriptionRepair: false,
      visualPrompt: '旧的道具连续性说明',
      evidenceSnippets: ['萧炎手上的戒指。'],
      sourceChapters: [1],
      sourceRangeHint: 'chapters 1-1',
    };
    const pack = buildStoryAssetPromptPack(story, {
      characters: [],
      scenes: [],
      props: [prop],
    });

    const prompt = pack.propPrompts[0].prompt;
    expect(prompt).toContain('多角度物品设定图');
    expect(prompt).toContain('正面');
    expect(prompt).toContain('侧面');
    expect(prompt).toContain('顶部');
    expect(prompt).toContain('细节特写');
    expect(prompt).toContain('戒指');
  });
});
