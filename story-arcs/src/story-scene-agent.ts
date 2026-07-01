import type { SceneInStory, StorySceneFile, StorySegment } from './types.js';
import { chaptersFor, findEvidence, qualityFor, sourceRangeHint, statusFor, uniqueNonEmpty } from './story-asset-utils.js';

const TIME_HINTS = ['清晨', '早晨', '白天', '正午', '黄昏', '夜晚', '深夜', '雨夜'];

function inferTimeHint(text: string): string | undefined {
  return TIME_HINTS.find((hint) => text.includes(hint));
}

export function extractStoryScenes(story: StorySegment): StorySceneFile {
  const locations = uniqueNonEmpty(story.locations.length > 0 ? story.locations : ['未指定场景']);
  const sourceChapters = chaptersFor(story);
  const involvedCharacters = uniqueNonEmpty([...story.mainCharacters, ...story.supportingCharacters]);

  const scenes = locations.map((location, index): SceneInStory => {
    const confidence = location === '未指定场景' ? 0.55 : 0.82;
    const evidenceSnippets = findEvidence(story.sourceText, location, story.summary);
    const description = location === '未指定场景'
      ? `A story scene for "${story.title}" with insufficient location detail.`
      : `${location} scene in "${story.title}", shaped by the conflict: ${story.coreConflict}`;
    const quality = qualityFor(description);

    return {
      id: `${story.id}-scene-${index + 1}`,
      name: `${story.title} - ${location}`,
      location,
      timeHint: inferTimeHint(story.sourceText),
      sourceRange: sourceRangeHint(story),
      summary: story.summary,
      conflictBeat: story.turningPoints[index] || story.coreConflict,
      involvedCharacters,
      confidence,
      assetStatus: statusFor(confidence),
      description,
      ...quality,
      visualPrompt: `${location}, cinematic scene, conflict beat: ${story.coreConflict}, maintain continuity with story characters and props`,
      evidenceSnippets,
      sourceChapters,
      sourceRangeHint: sourceRangeHint(story),
    };
  });

  return {
    storyId: story.id,
    bookId: story.bookId,
    scenes,
  };
}
