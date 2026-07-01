import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { storyAssetDirectory } from './story-asset-io.js';
import { planEpisodesForStory } from './episode-planner.js';
import { directScriptEpisode } from './director-agent.js';
import { reviewScriptEpisode } from './script-reviewer.js';
import { createStoryboardPromptPack } from './storyboard-prompt-agent.js';
import { createVideoPromptPack } from './video-prompt-agent.js';
import type {
  DirectorAssignment,
  ScriptEpisode,
  ScriptEpisodePlan,
  ScriptReview,
  StoryAssetBundle,
  StoryboardPromptPack,
  VideoPromptPack,
} from './types.js';

export interface DirectorPipelineOptions {
  outputDir?: string;
  writeFiles?: boolean;
  assignment?: Partial<DirectorAssignment>;
}

export interface DirectorPipelineResult {
  assignment: DirectorAssignment;
  episodePlans: ScriptEpisodePlan[];
  scriptEpisodes: ScriptEpisode[];
  scriptReview: ScriptReview;
  storyboardPromptPacks: StoryboardPromptPack[];
  videoPromptPacks: VideoPromptPack[];
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

function defaultAssignment(bundle: StoryAssetBundle, overrides: Partial<DirectorAssignment> = {}): DirectorAssignment {
  return {
    id: overrides.id || `assignment-${bundle.story.id}-draft`,
    bookId: bundle.story.bookId,
    assignmentType: overrides.assignmentType || 'single_story',
    storyIds: overrides.storyIds || [bundle.story.id],
    episodeNos: overrides.episodeNos,
    objective: overrides.objective || 'draft_script',
    styleNotes: overrides.styleNotes || ['短剧节奏', '强开场钩子', '冲突可视化'],
    constraints: overrides.constraints || ['不得改写故事边界', '不得加入未被来源支持的重大事实'],
    requestedBy: overrides.requestedBy || 'agent',
    createdAt: overrides.createdAt || new Date().toISOString(),
  };
}

async function writeDirectorFiles(outputDir: string, bundle: StoryAssetBundle, result: DirectorPipelineResult): Promise<string> {
  const dir = join(storyAssetDirectory(outputDir, bundle.story.bookId, bundle.story.id), 'director');
  await mkdir(dir, { recursive: true });
  await writeJson(join(dir, 'director-assignment.json'), result.assignment);
  await writeJson(join(dir, 'episode-plan.json'), { storyId: bundle.story.id, plans: result.episodePlans });
  await writeJson(join(dir, 'script-episodes.json'), { storyId: bundle.story.id, episodes: result.scriptEpisodes });
  await writeJson(join(dir, 'script-review.json'), result.scriptReview);
  await writeJson(join(dir, 'storyboard-prompt-pack.json'), result.storyboardPromptPacks[0]);
  await writeJson(join(dir, 'video-prompt-pack.json'), result.videoPromptPacks[0]);
  return dir;
}

export async function runDirectorPipelineForStory(
  bundle: StoryAssetBundle,
  options: DirectorPipelineOptions = {}
): Promise<DirectorPipelineResult> {
  if (!bundle.story.approved) {
    throw new Error(`Cannot run director pipeline for unapproved story: ${bundle.story.id}`);
  }

  const assignment = defaultAssignment(bundle, options.assignment);
  const episodePlans = planEpisodesForStory(bundle);
  const scriptEpisodes = episodePlans.map((plan) => directScriptEpisode(assignment, bundle, plan));
  const scriptReview = reviewScriptEpisode(scriptEpisodes[0], bundle);
  const storyboardPromptPacks = scriptReview.accepted
    ? [createStoryboardPromptPack(scriptEpisodes[0], bundle)]
    : [];
  const videoPromptPacks = storyboardPromptPacks.map((pack) => createVideoPromptPack(scriptEpisodes[0], pack, bundle));

  const result: DirectorPipelineResult = {
    assignment,
    episodePlans,
    scriptEpisodes,
    scriptReview,
    storyboardPromptPacks,
    videoPromptPacks,
  };

  if (options.writeFiles ?? true) {
    await writeDirectorFiles(options.outputDir ?? 'output', bundle, result);
  }

  return result;
}
