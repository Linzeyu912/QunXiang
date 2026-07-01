import type { DirectorAssignment, ScriptEpisode, ScriptEpisodePlan, StoryAssetBundle } from './types.js';
import { sourceRangeHint } from './story-asset-utils.js';

function dialogueFor(characters: string[], plan: ScriptEpisodePlan) {
  const lead = characters[0] || '主角';
  const challenger = characters[1] || '对手';
  return [
    { speaker: lead, line: `这件事，我不会再被动承受。`, emotion: '压抑后反击' },
    { speaker: challenger, line: `你确定要把局面推到这一步？`, emotion: '试探' },
    { speaker: lead, line: plan.endingButton, emotion: '坚定' },
  ];
}

export function directScriptEpisode(
  assignment: DirectorAssignment,
  bundle: StoryAssetBundle,
  plan: ScriptEpisodePlan
): ScriptEpisode {
  const story = bundle.story;
  const locations = bundle.assetPack.scenes.map((scene) => scene.location);
  const characters = bundle.assetPack.characters.map((character) => character.name);
  const props = bundle.assetPack.props.map((prop) => prop.name);
  const location = locations[0] || story.locations[0] || '未指定场景';
  const leadCharacters = characters.slice(0, 3);

  return {
    segmentId: story.id,
    episodeNo: plan.episodeNo,
    title: plan.title,
    durationSeconds: plan.estimatedDurationSeconds,
    hook: plan.hook,
    coreConflict: plan.episodeConflict,
    scenes: [
      {
        sceneNo: 1,
        location,
        characters: leadCharacters,
        action: `用可视动作开场：${plan.hook}。${leadCharacters[0] || '主角'}被迫面对${plan.episodeConflict}`,
        dialogue: dialogueFor(leadCharacters, plan),
        camera: 'wide establishing shot, then slow push-in to the protagonist reaction',
      },
      {
        sceneNo: 2,
        location,
        characters: leadCharacters,
        action: `冲突升级到转折：${plan.turningPoint}${props.length ? `，关键道具 ${props.slice(0, 2).join('、')} 入镜。` : '。'}`,
        dialogue: [
          { speaker: leadCharacters[0] || '主角', line: `我会用自己的方式结束这场羞辱。`, emotion: '克制爆发' },
        ],
        camera: 'medium shot with insert shots for key props and reaction close-ups',
      },
    ],
    endingButton: plan.endingButton,
    directorNotes: [
      `Assignment ${assignment.id} only adapts story ${story.id}.`,
      'Keep conflict visible through blocking, reaction shots, and prop inserts.',
      'Candidate or missing-appearance assets require conservative visual treatment.',
    ],
    sourceReferences: [sourceRangeHint(story), ...story.turningPoints.slice(0, 3)],
  };
}
