import type { ScriptEpisode, ScriptReview, StoryAssetBundle } from './types.js';

export function reviewScriptEpisode(episode: ScriptEpisode, bundle: StoryAssetBundle): ScriptReview {
  const issues: ScriptReview['issues'] = [];
  if (!episode.hook.trim()) {
    issues.push({ severity: 'blocker', message: 'Episode is missing an opening hook.' });
  }
  if (!episode.endingButton.trim()) {
    issues.push({ severity: 'blocker', message: 'Episode is missing an ending button.' });
  }
  if (!episode.coreConflict.includes(bundle.story.coreConflict.slice(0, 8))) {
    issues.push({ severity: 'warning', message: 'Episode conflict may drift from the story conflict.' });
  }
  if (episode.scenes.length === 0) {
    issues.push({ severity: 'blocker', message: 'Episode has no scenes.' });
  }

  return {
    segmentId: episode.segmentId,
    episodeNo: episode.episodeNo,
    accepted: !issues.some((issue) => issue.severity === 'blocker'),
    issues,
    notes: [
      'Checked hook, conflict, ending button, and scene presence.',
      `Story assets available: ${bundle.assetPack.characters.length} characters, ${bundle.assetPack.scenes.length} scenes, ${bundle.assetPack.props.length} props.`,
    ],
  };
}
