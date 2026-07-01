import type { ScriptEpisode, StoryAssetBundle, StoryboardPromptPack, VideoPromptPack } from './types.js';

export function createVideoPromptPack(
  episode: ScriptEpisode,
  storyboard: StoryboardPromptPack,
  bundle: StoryAssetBundle
): VideoPromptPack {
  const props = bundle.assetPack.props.map((prop) => prop.name);
  const globalContinuity = {
    styleGuide: 'Chinese fantasy short-drama, cinematic continuity, 16:9, source-grounded characters and props',
    characterRefs: storyboard.visualContinuity.characterRefs,
    sceneRefs: storyboard.visualContinuity.sceneRefs,
    propRefs: storyboard.visualContinuity.propRefs,
    aspectRatio: '16:9',
    targetDurationSeconds: episode.durationSeconds,
  };

  return {
    segmentId: episode.segmentId,
    episodeNo: episode.episodeNo,
    storyTitle: bundle.story.title,
    episodeTitle: episode.title,
    globalContinuity,
    clips: storyboard.frames.map((frame) => ({
      clipNo: frame.frameNo,
      sceneNo: frame.sceneNo,
      sourceFrameNos: [frame.frameNo],
      durationSeconds: Math.max(4, Math.round(episode.durationSeconds / Math.max(1, storyboard.frames.length))),
      prompt: `${frame.visualPrompt}. Motion: ${frame.action}. Emotion: ${frame.emotion}.`,
      negativePrompt: frame.negativePrompt,
      motion: frame.shotType === 'insert' ? 'precise prop emphasis, minimal movement' : 'controlled short-drama performance movement',
      cameraMovement: frame.camera,
      characters: frame.characters,
      location: frame.location,
      props,
      dialogue: episode.scenes.find((scene) => scene.sceneNo === frame.sceneNo)?.dialogue.map((line) => `${line.speaker}: ${line.line}`),
      soundNotes: ['subtle room tone', 'low dramatic pulse', 'brief silence before the ending button'],
      continuityNotes: ['preserve character identity', 'preserve source-grounded props', 'do not add unsupported plot facts'],
      sourceReferences: frame.sourceReferences,
    })),
  };
}
