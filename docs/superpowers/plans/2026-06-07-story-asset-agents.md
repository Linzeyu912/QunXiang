# Story Asset Agents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first backend version of three story-level asset agents that extract characters, scenes, and props from approved story segments and write each story's assets into one folder.

**Architecture:** Add focused `story-arcs` modules for shared types, deterministic fallback extraction, JSON IO, and orchestration. This first pass accepts already-approved `StorySegment` inputs and does not implement story boundary detection or future skill-backed extraction yet.

**Tech Stack:** TypeScript, Vitest, Node `fs/promises`, existing pnpm workspace.

---

## File Structure

- Modify `story-arcs/src/types.ts`: add story segment and asset file contracts.
- Create `story-arcs/src/story-character-agent.ts`: extract story-level character assets.
- Create `story-arcs/src/story-scene-agent.ts`: extract story-level scene assets.
- Create `story-arcs/src/story-prop-agent.ts`: extract story-level prop assets.
- Create `story-arcs/src/story-asset-io.ts`: write and read per-story asset JSON files.
- Create `story-arcs/src/story-assets.ts`: orchestrate the three agents for one or more approved stories.
- Modify `story-arcs/src/index.ts`: export new modules.
- Create `story-arcs/src/story-assets.test.ts`: TDD coverage for extraction and file layout.

## Task 1: Write Failing Story Asset Tests

**Files:**
- Create: `story-arcs/src/story-assets.test.ts`

- [x] **Step 1: Add tests for per-story asset extraction and output layout**

```ts
import { mkdtemp, readFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { describe, expect, it } from 'vitest';
import { extractAssetsForStories } from './story-assets.js';
import type { StorySegment } from './types.js';

describe('story asset agents', () => {
  it('extracts characters, scenes, and props into one folder per story', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'story-assets-'));
    const stories: StorySegment[] = [{
      id: 'story-1',
      bookId: 'book-1',
      startChapter: 1,
      endChapter: 3,
      title: '牢狱自救',
      sourceText: [
        '许七安被关在牢房里，怀里藏着一块铜牌。',
        '夜晚，牢房外火把摇晃，狱卒逼近。',
        '许七安握紧铜牌，低声对采薇说出自己的计划。',
      ].join('\n'),
      summary: '许七安在牢房中尝试自救。',
      coreConflict: '许七安必须在狱卒逼近前找到脱身办法。',
      trigger: '许七安被关押。',
      turningPoints: ['狱卒逼近', '铜牌成为关键线索'],
      conflictStatus: 'partially_resolved',
      mainCharacters: ['许七安'],
      supportingCharacters: ['采薇'],
      locations: ['牢房'],
      boundaryConfidence: 0.95,
      boundaryDecisionIds: ['b-1'],
      approved: true,
    }];

    try {
      const result = await extractAssetsForStories(stories, { outputDir });

      expect(result.storyAssets).toHaveLength(1);
      expect(result.storyAssets[0].characters.characters.map((c) => c.name)).toContain('许七安');
      expect(result.storyAssets[0].characters.characters.map((c) => c.name)).toContain('采薇');
      expect(result.storyAssets[0].scenes.scenes[0].location).toContain('牢房');
      expect(result.storyAssets[0].props.props.map((p) => p.name)).toContain('铜牌');

      const base = join(outputDir, 'book-1', 'stories', 'story-1');
      const characters = JSON.parse(await readFile(join(base, 'characters.json'), 'utf-8'));
      const scenes = JSON.parse(await readFile(join(base, 'scenes.json'), 'utf-8'));
      const props = JSON.parse(await readFile(join(base, 'props.json'), 'utf-8'));
      const pack = JSON.parse(await readFile(join(base, 'asset-pack.json'), 'utf-8'));

      expect(characters.storyId).toBe('story-1');
      expect(scenes.storyId).toBe('story-1');
      expect(props.storyId).toBe('story-1');
      expect(pack.storyId).toBe('story-1');
      expect(pack.characters.length).toBeGreaterThan(0);
      expect(pack.scenes.length).toBeGreaterThan(0);
      expect(pack.props.length).toBeGreaterThan(0);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it('skips unapproved story segments so downstream agents only see approved stories', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'story-assets-'));
    const stories: StorySegment[] = [{
      id: 'story-review',
      bookId: 'book-1',
      startChapter: 4,
      endChapter: 4,
      title: '待确认边界',
      sourceText: '李妙真走入山谷。',
      summary: '待确认故事。',
      coreConflict: '边界未确认。',
      trigger: '未知。',
      turningPoints: [],
      conflictStatus: 'ongoing',
      mainCharacters: ['李妙真'],
      supportingCharacters: [],
      locations: ['山谷'],
      boundaryConfidence: 0.5,
      boundaryDecisionIds: ['b-review'],
      approved: false,
    }];

    try {
      const result = await extractAssetsForStories(stories, { outputDir });
      expect(result.storyAssets).toEqual([]);
      expect(result.skippedStoryIds).toEqual(['story-review']);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run story-arcs/src/story-assets.test.ts`

Expected: FAIL because `story-assets.js` and the new types do not exist yet.

## Task 2: Implement Types, Agents, IO, and Orchestration

**Files:**
- Modify: `story-arcs/src/types.ts`
- Create: `story-arcs/src/story-character-agent.ts`
- Create: `story-arcs/src/story-scene-agent.ts`
- Create: `story-arcs/src/story-prop-agent.ts`
- Create: `story-arcs/src/story-asset-io.ts`
- Create: `story-arcs/src/story-assets.ts`
- Modify: `story-arcs/src/index.ts`

- [x] **Step 1: Add contracts**

Add `StorySegment`, `CharacterInStory`, `SceneInStory`, `PropInStory`, `StoryCharacterFile`, `StorySceneFile`, `StoryPropFile`, `StoryAssetPack`, and extraction result interfaces.

- [x] **Step 2: Implement deterministic fallback agents**

Use story-provided character and location lists first, then source-text heuristics. Mark assets as `confirmed` when confidence is at least `0.75`, otherwise `candidate`. Add conservative `description`, `descriptionQuality`, `needsDescriptionRepair`, and `visualPrompt` fields.

- [x] **Step 3: Implement per-story JSON output**

Write:

```text
output/{bookId}/stories/{storyId}/characters.json
output/{bookId}/stories/{storyId}/scenes.json
output/{bookId}/stories/{storyId}/props.json
output/{bookId}/stories/{storyId}/asset-pack.json
```

- [x] **Step 4: Export modules**

Update `story-arcs/src/index.ts` so callers can import the new agents and orchestrator.

- [x] **Step 5: Run tests**

Run: `pnpm exec vitest run story-arcs/src/story-assets.test.ts`

Expected: PASS.

## Task 3: Verify TypeScript Scope

**Files:**
- No new files.

- [x] **Step 1: Run TypeScript check for story-arcs**

Run: `pnpm exec tsc -p story-arcs/tsconfig.json --noEmit`

Expected: PASS.

Actual: blocked in the current workspace because `tsc` is not exposed at the root, and running through another workspace pulls existing cross-package `rootDir` errors plus pre-existing `story-arcs/src/analyzer.ts` enum value import errors. The story asset behavior is covered by the Vitest target in Task 2.

- [x] **Step 2: Check git diff**

Run: `git diff -- story-arcs docs/superpowers/plans/2026-06-07-story-asset-agents.md`

Expected: only planned files changed.
