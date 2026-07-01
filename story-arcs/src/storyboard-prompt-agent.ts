import type { ScriptEpisode, StoryAssetBundle, StoryboardFramePrompt, StoryboardPromptPack } from './types.js';

const SHOT_TYPES: StoryboardFramePrompt['shotType'][] = ['establishing', 'wide', 'medium', 'close_up', 'insert', 'reaction'];

function continuity(bundle: StoryAssetBundle) {
  return {
    styleGuide: 'Chinese fantasy short-drama, cinematic 16:9, restrained color palette, readable production-board labels',
    characterRefs: bundle.assetPack.characters.map((character) => `${character.name}: ${character.visualPrompt}`),
    sceneRefs: bundle.assetPack.scenes.map((scene) => `${scene.location}: ${scene.visualPrompt}`),
    propRefs: bundle.assetPack.props.map((prop) => `${prop.name}: ${prop.visualPrompt}`),
  };
}

export function createStoryboardPromptPack(episode: ScriptEpisode, bundle: StoryAssetBundle): StoryboardPromptPack {
  const frames: StoryboardFramePrompt[] = [];
  for (const scene of episode.scenes) {
    const baseRefs = [`scene ${scene.sceneNo}`, ...episode.sourceReferences];
    const beats = [
      { action: scene.action, emotion: scene.dialogue[0]?.emotion || 'tension rises' },
      { action: scene.dialogue[0]?.line || scene.action, emotion: scene.dialogue[0]?.emotion || 'focused' },
    ];
    for (const beat of beats) {
      const frameNo = frames.length + 1;
      const shotType = SHOT_TYPES[(frameNo - 1) % SHOT_TYPES.length];
      frames.push({
        frameNo,
        sceneNo: scene.sceneNo,
        shotType,
        narrativeBeat: beat.action,
        characters: scene.characters,
        location: scene.location,
        action: beat.action,
        emotion: beat.emotion,
        camera: `${shotType} framing, ${scene.camera || 'controlled cinematic camera'}`,
        visualPrompt: `${scene.location}, ${shotType} shot, ${beat.action}, characters: ${scene.characters.join('、')}, maintain asset continuity`,
        negativePrompt: 'avoid modern objects, avoid inconsistent faces, avoid unreadable tiny text',
        sourceReferences: baseRefs,
      });
    }
  }

  const visualContinuity = continuity(bundle);
  const productionBoardPrompt = [
    `创建一个电影制作板/视觉规划表，16:9 横版比例，用于《${bundle.story.title}》第 ${episode.episodeNo} 集《${episode.title}》。`,
    `顶部共享创意指导栏：镜头数量 ${frames.length}，统一调色板，整体环境 ${visualContinuity.sceneRefs.map((ref) => ref.split(':')[0]).join('、') || '故事指定场景'}，角色身份一致性要求。`,
    `角色与风格参考区：${visualContinuity.characterRefs.join('；') || 'consistent lead character from reference'}。`,
    `环境和场景设计区：包含空间路线、摄像机位置、镜头类型和移动路径。`,
    `故事板区：${frames.map((frame) => `Frame ${frame.frameNo}: ${frame.shotType}; ${frame.action}; ${frame.emotion}; ${frame.camera}`).join(' ')}`,
    '灯光/情绪/风格备注区：压抑、反击、家族冲突、低饱和电影感。',
    '音频/音调区：厅堂环境声、短促静默、低频鼓点推进。',
    '电影摄影笔记区：慢推、反应特写、道具插入镜头，保持画面变化和身份一致。',
  ].join('\n');

  return {
    segmentId: episode.segmentId,
    episodeNo: episode.episodeNo,
    storyTitle: bundle.story.title,
    episodeTitle: episode.title,
    visualContinuity,
    frames,
    productionBoardPrompt,
  };
}
