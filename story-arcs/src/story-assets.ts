import { extractStoryCharacters } from './story-character-agent.js';
import { extractStoryProps } from './story-prop-agent.js';
import { extractStoryScenes } from './story-scene-agent.js';
import { buildStoryAssetPromptPack } from './story-asset-prompts.js';
import { writeStoryAssetFiles } from './story-asset-io.js';
import type {
  AssetWarning,
  StoryAssetBundle,
  StoryAssetExtractionOptions,
  StoryAssetExtractionResult,
  StoryAssetPack,
  StorySegment,
} from './types.js';

function warningsForPack(pack: Omit<StoryAssetPack, 'assetWarnings'>): AssetWarning[] {
  const warnings: AssetWarning[] = [];

  for (const character of pack.characters) {
    if (character.needsDescriptionRepair) {
      warnings.push({
        assetType: 'character',
        assetName: character.name,
        issue: character.descriptionQuality === 'missing' ? 'missing_description' : 'thin_description',
        message: `${character.name} needs a stronger visual description before image generation.`,
      });
    }
    if (character.confidence < 0.75) {
      warnings.push({
        assetType: 'character',
        assetName: character.name,
        issue: 'low_confidence',
        message: `${character.name} is a candidate character and should not drive plot-critical visuals without review.`,
      });
    }
  }

  for (const scene of pack.scenes) {
    if (scene.needsDescriptionRepair) {
      warnings.push({
        assetType: 'scene',
        assetName: scene.name,
        issue: scene.descriptionQuality === 'missing' ? 'missing_description' : 'thin_description',
        message: `${scene.name} needs a stronger visual description before image generation.`,
      });
    }
    if (scene.confidence < 0.75) {
      warnings.push({
        assetType: 'scene',
        assetName: scene.name,
        issue: 'low_confidence',
        message: `${scene.name} is a candidate scene and should be treated as reference only.`,
      });
    }
  }

  for (const prop of pack.props) {
    if (prop.needsDescriptionRepair) {
      warnings.push({
        assetType: 'prop',
        assetName: prop.name,
        issue: prop.descriptionQuality === 'missing' ? 'missing_description' : 'thin_description',
        message: `${prop.name} needs a stronger visual description before image generation.`,
      });
    }
    if (prop.confidence < 0.75) {
      warnings.push({
        assetType: 'prop',
        assetName: prop.name,
        issue: 'low_confidence',
        message: `${prop.name} is a candidate prop and should be treated as reference only.`,
      });
    }
  }

  return warnings;
}

export function buildStoryAssetBundle(story: StorySegment): StoryAssetBundle {
  const characters = extractStoryCharacters(story);
  const scenes = extractStoryScenes(story);
  const props = extractStoryProps(story);
  const packBase = {
    storyId: story.id,
    bookId: story.bookId,
    characters: characters.characters,
    scenes: scenes.scenes,
    props: props.props,
  };
  const assetPack: StoryAssetPack = {
    ...packBase,
    assetWarnings: warningsForPack(packBase),
  };
  const assetPrompts = buildStoryAssetPromptPack(story, packBase);

  return {
    story,
    characters,
    scenes,
    props,
    assetPack,
    assetPrompts,
  };
}

export async function extractAssetsForStories(
  stories: StorySegment[],
  options: StoryAssetExtractionOptions = {}
): Promise<StoryAssetExtractionResult> {
  const outputDir = options.outputDir ?? 'output';
  const writeFiles = options.writeFiles ?? true;
  const bookDirName = options.bookDirName;
  const storyAssets: StoryAssetBundle[] = [];
  const skippedStoryIds: string[] = [];

  for (const story of stories) {
    if (!story.approved) {
      skippedStoryIds.push(story.id);
      continue;
    }

    const bundle = buildStoryAssetBundle(story);
    if (writeFiles) {
      await writeStoryAssetFiles(outputDir, {
        story: bundle.story,
        characters: bundle.characters,
        scenes: bundle.scenes,
        props: bundle.props,
        assetPack: bundle.assetPack,
        assetPrompts: bundle.assetPrompts,
      }, bookDirName);
    }
    storyAssets.push(bundle);
  }

  return {
    storyAssets,
    skippedStoryIds,
  };
}
