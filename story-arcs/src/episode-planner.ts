import type { ScriptEpisodePlan, StoryAssetBundle } from './types.js';
import { sourceRangeHint } from './story-asset-utils.js';

export function planEpisodesForStory(bundle: StoryAssetBundle): ScriptEpisodePlan[] {
  const story = bundle.story;
  const turningPoint = story.turningPoints[0] || story.trigger;
  return [{
    segmentId: story.id,
    episodeNo: 1,
    title: `${story.title}：${turningPoint}`,
    sourceRangeHint: sourceRangeHint(story),
    episodeConflict: story.coreConflict,
    hook: story.trigger,
    turningPoint,
    endingButton: story.turningPoints[1] || story.resolution || '冲突尚未解决，新的选择逼近。',
    estimatedDurationSeconds: 90,
  }];
}
