import type {
  CharacterInStory,
  PropInStory,
  SceneInStory,
  StoryAssetPromptPack,
  StoryAssetVisualPrompt,
  StorySegment,
} from './types.js';

const CHARACTER_NEGATIVE =
  '对白文字, 剧情场景, 动作分镜, unsupported facial features, invented clothing, invented age, modern outfit, inconsistent identity';
const SCENE_NEGATIVE =
  'unsupported architecture, invented weather, unrelated props, inconsistent location, character close-up, unreadable text';
const PROP_NEGATIVE =
  'unsupported material, invented inscription, wrong scale, unrelated ornament, inconsistent ownership, hand-held action scene';

function characterPrompt(
  character: CharacterInStory,
  story: StorySegment,
  options: { allowSupplement?: boolean } = {}
): StoryAssetVisualPrompt {
  const { allowSupplement = true } = options;

  const appearance = character.appearanceDescription.trim()
    || '（原文未描述具体外貌）';

  const supplementNote = allowSupplement
    ? '允许基于角色的年龄、性别、身份、故事背景合理补写原文未明确的视觉细节（如默认服装风格、发型、体态等），补写部分标注[AI补写]'
    : '仅使用原文支持的外貌细节，未确认的维度保持空白，不添加原文未支持的五官、服饰、年龄、发型、饰品或体型细节';

  const repairNote = character.needsAppearanceRepair
    ? '⚠ 外貌信息严重不足，以下维度需要重点补写'
    : '';

  // Build visual breakdown with line breaks for easy editing
  const lines: string[] = [];
  lines.push(`${character.name}，四视图角色设定图`);
  lines.push('');
  lines.push('正面、侧面、背面、面部特写，同一人物身份保持一致');
  lines.push('');
  lines.push('角色设定拆解：服装/配色、面部/五官、发型、体态/身形、神情/气质、饰物/随身特征逐项呈现');
  lines.push(`外貌描写：${appearance}`);
  lines.push('');
  lines.push(supplementNote);
  if (repairNote) lines.push(repairNote);
  lines.push('');
  lines.push('全身角色参考，面部近景清晰，服饰轮廓清晰，干净中性背景');
  lines.push('无对白文字，无剧情场景，无夸张动作');

  return {
    assetType: 'character',
    assetId: character.name,
    assetName: character.name,
    prompt: lines.join('\n'),
    negativePrompt: CHARACTER_NEGATIVE,
    descriptionQuality: character.descriptionQuality,
    needsDescriptionRepair: character.needsDescriptionRepair || character.needsAppearanceRepair,
    evidenceSnippets: character.appearanceEvidenceSnippets.length > 0
      ? character.appearanceEvidenceSnippets
      : character.evidenceSnippets,
    sourceChapters: character.sourceChapters,
    sourceRangeHint: character.sourceRangeHint,
    metadata: {
      storyId: story.id,
      roleInStory: character.roleInStory,
      appearanceDescription: character.appearanceDescription,
      needsAppearanceRepair: character.needsAppearanceRepair,
      allowSupplement,
    },
  };
}

function scenePrompt(scene: SceneInStory, story: StorySegment): StoryAssetVisualPrompt {
  const timeHint = scene.timeHint ? `时间线索：${scene.timeHint}` : '时间线索：原文未明确';
  const involved = scene.involvedCharacters.length > 0
    ? `可保留人物比例参考：${scene.involvedCharacters.join('、')}`
    : '不强调人物，优先环境结构';

  return {
    assetType: 'scene',
    assetId: scene.id,
    assetName: scene.location,
    prompt: [
      `${scene.location}，多方位场景设定图`,
      '入口视角、反向视角、俯视布局、关键细节特写',
      timeHint,
      `场景描述：${scene.description}`,
      `冲突氛围：${scene.conflictBeat}`,
      involved,
      '保持空间结构一致，干净环境参考，无对白文字，不添加原文未支持的建筑、天气或陈设',
    ].join('；'),
    negativePrompt: SCENE_NEGATIVE,
    descriptionQuality: scene.descriptionQuality,
    needsDescriptionRepair: scene.needsDescriptionRepair,
    evidenceSnippets: scene.evidenceSnippets,
    sourceChapters: scene.sourceChapters,
    sourceRangeHint: scene.sourceRangeHint,
    metadata: {
      storyId: story.id,
      location: scene.location,
      timeHint: scene.timeHint,
      conflictBeat: scene.conflictBeat,
      involvedCharacters: scene.involvedCharacters,
    },
  };
}

function propPrompt(prop: PropInStory, story: StorySegment): StoryAssetVisualPrompt {
  const owner = prop.ownerOrHolder ? `持有者/关联人物：${prop.ownerOrHolder}` : '持有者未明确';

  return {
    assetType: 'prop',
    assetId: prop.name,
    assetName: prop.name,
    prompt: [
      `${prop.name}，多角度物品设定图`,
      '正面、侧面、顶部、底部或背面、细节特写',
      `物品类型：${prop.propType}`,
      `物品描述：${prop.description}`,
      owner,
      '中性背景，单独展示物品，比例清晰，适合后续建模/绘制参考',
      '不添加原文未支持的材质、铭文、花纹、尺寸或损坏痕迹',
    ].join('；'),
    negativePrompt: PROP_NEGATIVE,
    descriptionQuality: prop.descriptionQuality,
    needsDescriptionRepair: prop.needsDescriptionRepair,
    evidenceSnippets: prop.evidenceSnippets,
    sourceChapters: prop.sourceChapters,
    sourceRangeHint: prop.sourceRangeHint,
    metadata: {
      storyId: story.id,
      propType: prop.propType,
      ownerOrHolder: prop.ownerOrHolder,
      storyFunction: prop.storyFunction,
    },
  };
}

export function buildStoryAssetPromptPack(
  story: StorySegment,
  assets: {
    characters: CharacterInStory[];
    scenes: SceneInStory[];
    props: PropInStory[];
  },
  options: { allowSupplement?: boolean } = {}
): StoryAssetPromptPack {
  const characterPrompts = assets.characters.map((character) => characterPrompt(character, story, options));
  const scenePrompts = assets.scenes.map((scene) => scenePrompt(scene, story));
  const propPrompts = assets.props.map((prop) => propPrompt(prop, story));

  return {
    storyId: story.id,
    bookId: story.bookId,
    characterPrompts,
    scenePrompts,
    propPrompts,
    allPrompts: [...characterPrompts, ...scenePrompts, ...propPrompts],
  };
}
