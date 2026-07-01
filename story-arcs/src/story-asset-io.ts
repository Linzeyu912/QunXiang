import { mkdir, readFile, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import type {
  StoryAssetPack,
  StoryAssetPromptPack,
  StoryCharacterFile,
  StoryPropFile,
  StorySceneFile,
  StorySegment,
} from './types.js';

export function storyAssetDirectory(outputDir: string, bookDirName: string, storyId: string): string {
  return resolve(outputDir, bookDirName, 'stories', storyId);
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

export async function writeStoryAssetFiles(
  outputDir: string,
  files: {
    story?: StorySegment;
    characters: StoryCharacterFile;
    scenes: StorySceneFile;
    props: StoryPropFile;
    assetPack: StoryAssetPack;
    assetPrompts: StoryAssetPromptPack;
  },
  bookDirName?: string
): Promise<string> {
  const dirName = bookDirName || files.assetPack.bookId;
  const dir = storyAssetDirectory(outputDir, dirName, files.assetPack.storyId);
  await mkdir(dir, { recursive: true });

  if (files.story) {
    await writeJson(join(dir, 'story.json'), files.story);
  }
  await writeJson(join(dir, 'characters.json'), files.characters);
  await writeJson(join(dir, 'scenes.json'), files.scenes);
  await writeJson(join(dir, 'props.json'), files.props);
  await writeJson(join(dir, 'asset-pack.json'), files.assetPack);
  await writeJson(join(dir, 'character-prompts.json'), {
    storyId: files.assetPrompts.storyId,
    bookId: files.assetPrompts.bookId,
    prompts: files.assetPrompts.characterPrompts,
  });
  await writeJson(join(dir, 'scene-prompts.json'), {
    storyId: files.assetPrompts.storyId,
    bookId: files.assetPrompts.bookId,
    prompts: files.assetPrompts.scenePrompts,
  });
  await writeJson(join(dir, 'prop-prompts.json'), {
    storyId: files.assetPrompts.storyId,
    bookId: files.assetPrompts.bookId,
    prompts: files.assetPrompts.propPrompts,
  });
  await writeJson(join(dir, 'asset-prompts.json'), files.assetPrompts);

  return dir;
}

export async function readStoryAssetPack(outputDir: string, bookId: string, storyId: string): Promise<StoryAssetPack> {
  const dir = storyAssetDirectory(outputDir, bookId, storyId);
  return JSON.parse(await readFile(join(dir, 'asset-pack.json'), 'utf-8')) as StoryAssetPack;
}
