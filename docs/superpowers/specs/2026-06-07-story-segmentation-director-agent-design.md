# Story Segmentation and Director Agent Design

## Goal

Build a backend pipeline that turns an uploaded novel TXT into reliable story-level units, then adapts each approved story unit into one or more short-drama script episodes.

The system must not treat chapters as final story units. Chapters remain a stable low-level parsing structure. A story segment may span multiple chapters when those chapters continue the same conflict, mission, case, relationship turn, or event chain.

The main quality constraint is correctness of story boundaries. Downstream agents, especially character-focused agents, will rely on these story units. When the system is not confident about a boundary, it must not silently guess. It must create a review item.

## Non-Goals

- Do not change the frontend in the first implementation.
- Do not replace the existing TXT chapter splitter. Keep it as source structure.
- Do not merge this flow into the existing entity extraction pipeline.
- Do not require the director agent to extract all character facts by itself.
- Do not generate final production-ready screenplays without source references.

## Pipeline

```text
TXT input
  -> existing parseTxtEnhanced chapter parsing
  -> ChapterAnalyzer
  -> BoundaryJudge
  -> BoundaryVerifier
  -> BoundaryReviewQueue
  -> approved StorySegment records/files
  -> StoryCharacterAgent, StorySceneAgent, StoryPropAgent
  -> asset self-check and visual prompt preparation
  -> StoryContextPack generation
  -> DirectorAssignment selection
  -> EpisodePlanner
  -> DirectorAgent
  -> ScriptReviewer
  -> StoryboardPromptAgent
  -> VideoPromptAgent
  -> output script files
```

The flow is intentionally separated from the existing `extractor -> validator -> entity-resolution -> reviewer` pipeline. Entity extraction and short-drama adaptation have different correctness criteria and should remain separately testable.

After story boundaries are approved, three story-level asset agents run independently over each story segment:

- `StoryCharacterAgent`: extracts characters and their story-specific role, motivation, actions, and visual description.
- `StorySceneAgent`: extracts scene locations/beats and their visual description.
- `StoryPropAgent`: extracts props/items and their story function plus visual description.

Story boundaries are strict and blocking. Story assets are non-blocking: uncertain assets can be emitted as candidates with confidence and evidence, but the director must treat low-confidence assets as reference material rather than plot-critical facts.

The director agent is not tied to exactly one story or to automatic full-book processing. It is assignment-driven: a user, scheduler, or future orchestration layer selects which approved story segment or set of story segments the director should adapt.

## Core Rule: No Unsafe Story Boundaries

Boundary decisions have three outcomes:

```ts
type BoundaryDecision = 'same_story' | 'new_story' | 'needs_review';
```

Only confident decisions can produce formal story segments.

- `same_story`: adjacent chapters continue the same story segment.
- `new_story`: adjacent chapters have a clear boundary between story segments.
- `needs_review`: evidence is mixed, incomplete, or below confidence threshold.

If any boundary inside a candidate segment is `needs_review`, that candidate segment is not released to downstream agents until the boundary is resolved by a review pass.

The first implementation can store review items as JSON files. A future frontend can consume the same files or persisted records.

## Data Contracts

### ChapterAnalysis

One record per parsed chapter.

```ts
interface ChapterAnalysis {
  bookId: string;
  chapterIndex: number;
  title?: string;
  summary: string;
  mainCharacters: string[];
  supportingCharacters: string[];
  locations: string[];
  activeConflicts: string[];
  resolvedConflicts: string[];
  unresolvedThreads: string[];
  newThreads: string[];
  keyEvents: string[];
  endingState: string;
}
```

### BoundaryReviewItem

Created when a boundary cannot be trusted.

```ts
interface BoundaryReviewItem {
  id: string;
  bookId: string;
  betweenChapter: [number, number];
  suggestedDecision: 'same_story' | 'new_story';
  confidence: number;
  reason: string;
  evidence: {
    continuingConflicts: string[];
    resolvedConflicts: string[];
    newConflicts: string[];
    continuingCharacters: string[];
    changedCharacters: string[];
    goalShift?: string;
  };
  leftChapterSummary: string;
  rightChapterSummary: string;
}
```

### StorySegment

Formal story unit consumed by downstream agents.

```ts
interface StorySegment {
  id: string;
  bookId: string;
  startChapter: number;
  endChapter: number;
  sourceText: string;
  title: string;
  summary: string;
  coreConflict: string;
  trigger: string;
  turningPoints: string[];
  resolution?: string;
  conflictStatus: 'resolved' | 'partially_resolved' | 'ongoing';
  mainCharacters: string[];
  supportingCharacters: string[];
  locations: string[];
  boundaryConfidence: number;
  boundaryDecisionIds: string[];
  approved: boolean;
}
```

### StoryContextPack

Stable input for character agents, episode planning, and director adaptation.

```ts
interface StoryContextPack {
  segmentId: string;
  bookId: string;
  sourceChapters: number[];
  fullText: string;
  summary: string;
  coreConflict: string;
  conflictStatus: 'resolved' | 'partially_resolved' | 'ongoing';
  mainCharacters: CharacterInStory[];
  supportingCharacters: CharacterInStory[];
  scenes: SceneInStory[];
  props: PropInStory[];
  locations: string[];
  unresolvedThreads: string[];
  boundaryEvidence: BoundaryDecisionEvidence[];
}

interface CharacterInStory {
  name: string;
  roleInStory: string;
  firstMentionChapter: number;
  lastMentionChapter: number;
  evidenceSnippets: string[];
  confidence: number;
  assetStatus: 'confirmed' | 'candidate';
  description: string;
  descriptionQuality: 'sufficient' | 'thin' | 'missing';
  needsDescriptionRepair: boolean;
  visualPrompt: string;
}

interface SceneInStory {
  id: string;
  name: string;
  location: string;
  timeHint?: string;
  sourceRange: string;
  summary: string;
  conflictBeat: string;
  involvedCharacters: string[];
  evidenceSnippets: string[];
  confidence: number;
  assetStatus: 'confirmed' | 'candidate';
  description: string;
  descriptionQuality: 'sufficient' | 'thin' | 'missing';
  needsDescriptionRepair: boolean;
  visualPrompt: string;
}

interface PropInStory {
  name: string;
  aliases: string[];
  propType: 'weapon' | 'document' | 'token' | 'tool' | 'money' | 'other';
  storyFunction: string;
  ownerOrHolder?: string;
  firstAppearance: string;
  keyMoments: string[];
  evidenceSnippets: string[];
  confidence: number;
  assetStatus: 'confirmed' | 'candidate';
  description: string;
  descriptionQuality: 'sufficient' | 'thin' | 'missing';
  needsDescriptionRepair: boolean;
  visualPrompt: string;
}
```

### Story Asset Files

Each approved story segment gets separate asset files. These files are designed for both director adaptation and later image-generation skills.

```ts
interface StoryCharacterFile {
  storyId: string;
  characters: CharacterInStory[];
}

interface StorySceneFile {
  storyId: string;
  scenes: SceneInStory[];
}

interface StoryPropFile {
  storyId: string;
  props: PropInStory[];
}

interface StoryAssetPack {
  storyId: string;
  characters: CharacterInStory[];
  scenes: SceneInStory[];
  props: PropInStory[];
  assetWarnings: AssetWarning[];
}

interface AssetWarning {
  assetType: 'character' | 'scene' | 'prop';
  assetName: string;
  issue: 'missing_description' | 'thin_description' | 'low_confidence' | 'weak_evidence';
  message: string;
}
```

### DirectorAssignment

Explicit work order for the director agent. This is how the user or scheduler specifies which story scope the director owns.

```ts
interface DirectorAssignment {
  id: string;
  bookId: string;
  assignmentType: 'single_story' | 'story_batch' | 'episode_revision';
  storyIds: string[];
  episodeNos?: number[];
  objective: 'draft_script' | 'revise_script' | 'create_storyboard_prompts';
  styleNotes?: string[];
  constraints?: string[];
  requestedBy: 'user' | 'scheduler' | 'agent';
  createdAt: string;
}
```

Rules:

- The director only adapts stories listed in `storyIds`.
- `storyIds` must refer to approved story segments.
- `single_story` usually produces one or more `ScriptEpisode` records for one story.
- `story_batch` lets the director adapt multiple approved stories in one assigned lane while keeping outputs separated by story.
- `episode_revision` targets existing episode numbers for rewrite or storyboard prompt refresh.
- The director must not pull neighboring stories into scope unless a new assignment includes them.

### ScriptEpisodePlan

Director planning output before full script writing.

```ts
interface ScriptEpisodePlan {
  segmentId: string;
  episodeNo: number;
  title: string;
  sourceRangeHint: string;
  episodeConflict: string;
  hook: string;
  turningPoint: string;
  endingButton: string;
  estimatedDurationSeconds: number;
}
```

### ScriptEpisode

Final structured script output.

```ts
interface ScriptEpisode {
  segmentId: string;
  episodeNo: number;
  title: string;
  durationSeconds: number;
  hook: string;
  coreConflict: string;
  scenes: ScriptScene[];
  endingButton: string;
  directorNotes: string[];
  sourceReferences: string[];
}

interface ScriptScene {
  sceneNo: number;
  location: string;
  characters: string[];
  action: string;
  dialogue: Array<{
    speaker: string;
    line: string;
    emotion?: string;
  }>;
  camera?: string;
}
```

### StoryboardPromptPack

Prompt preparation output for a future storyboard or shot-image skill. This is not the final generated storyboard image. It is a structured prompt contract that keeps visual continuity, source references, and shot intent available to a later skill.

```ts
interface StoryboardPromptPack {
  segmentId: string;
  episodeNo: number;
  storyTitle: string;
  episodeTitle: string;
  visualContinuity: {
    styleGuide: string;
    characterRefs: string[];
    sceneRefs: string[];
    propRefs: string[];
  };
  frames: StoryboardFramePrompt[];
}

interface StoryboardFramePrompt {
  frameNo: number;
  sceneNo: number;
  shotType: 'establishing' | 'wide' | 'medium' | 'close_up' | 'insert' | 'over_shoulder' | 'reaction';
  narrativeBeat: string;
  characters: string[];
  location: string;
  action: string;
  emotion: string;
  camera: string;
  visualPrompt: string;
  negativePrompt?: string;
  sourceReferences: string[];
}
```

### VideoPromptPack

Prompt preparation output for a future video-generation skill. This is not the final generated video and does not call the future skill directly. It is a skill-ready prompt contract that turns accepted scripts and storyboard frames into video prompt units.

```ts
interface VideoPromptPack {
  segmentId: string;
  episodeNo: number;
  storyTitle: string;
  episodeTitle: string;
  targetSkill?: string;
  skillProfile?: VideoSkillProfile;
  globalContinuity: {
    styleGuide: string;
    characterRefs: string[];
    sceneRefs: string[];
    propRefs: string[];
    aspectRatio?: string;
    targetDurationSeconds?: number;
  };
  clips: VideoClipPrompt[];
}

interface VideoSkillProfile {
  skillName: string;
  version?: string;
  expectedFields: string[];
  notes?: string[];
}

interface VideoClipPrompt {
  clipNo: number;
  sceneNo: number;
  sourceFrameNos: number[];
  durationSeconds: number;
  prompt: string;
  negativePrompt?: string;
  motion: string;
  cameraMovement: string;
  characters: string[];
  location: string;
  props: string[];
  dialogue?: string[];
  soundNotes?: string[];
  continuityNotes: string[];
  sourceReferences: string[];
}
```

## Agents and Responsibilities

### ChapterAnalyzer

Input: parsed chapters from `parseTxtEnhanced`.

Output: `ChapterAnalysis[]`.

Responsibilities:

- Summarize each chapter.
- Identify active, resolved, and newly opened conflicts.
- Identify character continuity signals.
- Capture ending state so the boundary judge can compare adjacent chapters.

### BoundaryJudge

Input: adjacent `ChapterAnalysis` pairs.

Output: boundary decisions and evidence.

Decision criteria:

- Continue if the same core conflict, goal, case, mission, relationship turn, or immediate danger continues.
- Cut if the prior conflict reaches a clear phase resolution and the next chapter opens a different dominant goal.
- Mark `needs_review` when evidence is mixed, confidence is low, or both chapters share characters but the goal/conflict relationship is unclear.

Recommended initial thresholds:

- `confidence >= 0.82`: accept `same_story` or `new_story`.
- `0.65 <= confidence < 0.82`: create `BoundaryReviewItem`.
- `confidence < 0.65`: create `BoundaryReviewItem` with stronger warning.

### BoundaryVerifier

Input: proposed story segments and boundary evidence.

Output: approved story segments or review items.

Checks:

- The segment has a coherent core conflict.
- The segment does not cut off an unresolved primary conflict.
- The segment does not combine two unrelated dominant conflicts.
- Main characters remain explainable across the segment.
- Every formal segment can explain why it starts and ends where it does.

### EpisodePlanner

Input: a `DirectorAssignment` and the approved `StoryContextPack` entries named in that assignment.

Output: `ScriptEpisodePlan[]`.

Responsibilities:

- Decide how many short-drama episodes a story segment should produce.
- Give each episode a smaller conflict and ending hook.
- Preserve the parent story segment's larger conflict.

The default target is 1-3 minutes per episode. Long story segments can produce multiple episodes.

### StoryCharacterAgent

Input: approved `StorySegment` and its source text.

Output: `StoryCharacterFile`.

Exclusive skill: `story-character-asset-extractor`.

Responsibilities:

- Extract characters that matter inside this story segment.
- Classify each character's role in this specific story, not globally across the whole novel.
- Capture motivation, relationship to the core conflict, key actions, and evidence snippets.
- Produce a visual description suitable for later image prompt generation.
- Run a self-check over every character to mark whether the visual description is sufficient.

The agent may emit candidate characters. Candidate characters must include confidence and evidence. They do not block director generation.

### StorySceneAgent

Input: approved `StorySegment` and its source text.

Output: `StorySceneFile`.

Exclusive skill: `story-scene-asset-extractor`.

Responsibilities:

- Extract story-level scenes, not necessarily every physical paragraph.
- Capture scene location, time hint, involved characters, conflict beat, and evidence snippets.
- Produce a visual description of the place, mood, and visible action.
- Run a self-check over every scene to mark whether the visual description is sufficient.

### StoryPropAgent

Input: approved `StorySegment` and its source text.

Output: `StoryPropFile`.

Exclusive skill: `story-prop-asset-extractor`.

Responsibilities:

- Extract props, items, weapons, documents, tokens, tools, money, or other physical objects that matter to the story.
- Capture the object's owner/holder, story function, key moments, and evidence snippets.
- Produce a visual description suitable for later image prompt generation.
- Run a self-check over every prop to mark whether the visual description is sufficient.

### Asset Self-Check

Each asset agent checks its own output before writing files.

Description quality rules:

- `sufficient`: enough visible detail to support later image generation.
- `thin`: recognizable asset but missing important visual details.
- `missing`: no useful visual description.

Assets with `thin` or `missing` descriptions remain in the output, but `needsDescriptionRepair` must be true and an `AssetWarning` must be emitted. This does not block story segmentation or director generation.

### Visual Prompt Preparation

Each asset must include a `visualPrompt` field. This is not the final image-generation skill prompt. It is a structured, model-agnostic draft that a later skill can refine.

Visual prompt rules:

- Use concrete visible details from the source text and evidence snippets.
- Avoid inventing major costume, era, or environment details not supported by the story.
- Include role/function when it affects visual design.
- For characters, include age range if inferable, body language, clothing clues, emotional tone, and distinguishing details.
- For scenes, include location, time/mood, visible action, key props, and atmosphere.
- For props, include material, shape, state, owner/holder, and story function when inferable.

### DirectorAgent

Input: one `DirectorAssignment`, the selected `StoryContextPack`/`StoryAssetPack` pair for the current story, and one `ScriptEpisodePlan`.

Output: `ScriptEpisode`.

Responsibilities:

- Adapt only the story scope named by the assignment.
- Convert narration into visible action and dialogue.
- Strengthen the opening hook.
- Keep the original event logic and character relationships.
- Make conflict escalation explicit.
- End each episode with a button, reversal, question, or unresolved emotional beat.
- Include source references for auditability.
- Use confirmed assets freely.
- Treat candidate assets as reference only; do not make them plot-critical unless the source text in the context pack supports them again.

When an assignment includes multiple stories, outputs must remain separated by `storyId`. The director can share style notes across the batch, but it must not merge story context packs or rewrite boundaries.

### ScriptReviewer

Input: generated script episode and context pack.

Output: accepted script or flagged issue.

Checks:

- The script preserves the episode conflict.
- The script does not invent major incompatible facts.
- Characters speak and act consistently with the context pack.
- The episode has a hook, escalation, and ending button.

### StoryboardPromptAgent

Input: one accepted `ScriptEpisode`, its `StoryContextPack`, and its `StoryAssetPack`.

Output: `StoryboardPromptPack`.

Exclusive skill: `storyboard-visual-planner`.

Responsibilities:

- Turn each script episode into a sequence of storyboard frame prompts.
- Use the `storyboard-visual-planner` skill to create the director-style 16:9 film production board / visual planning prompt for the assigned story or episode.
- Preserve continuity from story-level character, scene, and prop visual prompts.
- Keep prompts tied to scene numbers, narrative beats, and source references.
- Describe shot intent, camera framing, character action, emotional tone, and visible props.
- Avoid becoming the image-generation implementation. A later skill will consume this prompt pack and create storyboard images or a visual board.
- `storyboard-visual-planner` is reserved for `StoryboardPromptAgent`; other agents, including `DirectorAgent`, must not call it directly.

Frame selection rules:

- Include at least one opening hook frame.
- Include major conflict escalation frames.
- Include key reaction frames where emotion matters.
- Include insert frames for plot-critical props.
- Include an ending-button frame for the episode close.

The prompt pack must be stable enough for a later storyboard skill to generate either:

- one image per selected frame;
- a multi-panel storyboard sheet;
- or a shot-by-shot visual board.

### VideoPromptAgent

Input: one accepted `ScriptEpisode`, its `StoryboardPromptPack`, its `StoryContextPack`, its `StoryAssetPack`, and an optional future video skill profile.

Output: `VideoPromptPack`.

Responsibilities:

- Convert the accepted script and storyboard frame prompts into video prompt units.
- Preserve character, scene, prop, and camera continuity.
- Prepare prompts according to the target video skill contract when that skill is provided later.
- Keep prompts tied to episode, scene, frame, and source references.
- Describe motion, camera movement, action timing, character emotion, visible props, and optional sound/dialogue notes.
- Avoid becoming the video-generation implementation. The future skill consumes this prompt pack and creates videos.

Clip selection rules:

- Default to one video clip per important storyboard frame or short frame group.
- Merge adjacent frames only when they are part of one continuous action.
- Keep each clip short enough for video-model controllability.
- Include an opening hook clip, conflict escalation clips, critical prop/action clips, and ending-button clip.

The agent must remain skill-driven. Until the user provides the final video skill, `targetSkill` and `skillProfile` can be absent and the prompt pack stays model-agnostic.

## Output Files for First Version

Use file output first so the backend flow can be tested before any frontend work.

```text
output/{bookId}/chapter-analysis.json
output/{bookId}/story-boundary-decisions.json
output/{bookId}/story-boundary-review.json
output/{bookId}/story-segments.json
output/{bookId}/story-context-packs.json
output/{bookId}/director-assignments.json
output/{bookId}/script-episode-plans.json
output/{bookId}/script-episodes.json
output/{bookId}/storyboard-prompt-packs.json
output/{bookId}/video-prompt-packs.json
output/{bookId}/stories/{storyId}/characters.json
output/{bookId}/stories/{storyId}/scenes.json
output/{bookId}/stories/{storyId}/props.json
output/{bookId}/stories/{storyId}/asset-pack.json
output/{bookId}/stories/{storyId}/episodes/{episodeNo}/script.json
output/{bookId}/stories/{storyId}/episodes/{episodeNo}/storyboard-prompts.json
output/{bookId}/stories/{storyId}/episodes/{episodeNo}/video-prompts.json
```

Downstream agents must only consume `story-context-packs.json` entries whose source `StorySegment.approved` is true.

## Suggested Module Layout

Add the implementation to the existing `story-arcs` workspace.

```text
story-arcs/src/chapter-summarizer.ts
story-arcs/src/story-segmenter.ts
story-arcs/src/boundary-judge.ts
story-arcs/src/boundary-verifier.ts
story-arcs/src/story-character-agent.ts
story-arcs/src/story-scene-agent.ts
story-arcs/src/story-prop-agent.ts
story-arcs/src/asset-self-check.ts
story-arcs/src/director-assignment.ts
story-arcs/src/episode-planner.ts
story-arcs/src/director-agent.ts
story-arcs/src/script-reviewer.ts
story-arcs/src/storyboard-prompt-agent.ts
story-arcs/src/video-prompt-agent.ts
story-arcs/src/io.ts
story-arcs/src/types.ts
```

The existing `import` package should remain responsible for decoding, preprocessing, and chapter parsing. The `story-arcs` package consumes parsed chapters and produces story/script artifacts.

## Prompt Shape

### BoundaryJudge Prompt

System role: story structure analyst.

Task:

- Compare two adjacent chapters.
- Decide whether they belong to the same story segment.
- Return strict JSON with decision, confidence, and evidence.
- If uncertain, return `needs_review`.

Important instruction:

```text
Do not guess story boundaries. If the evidence is mixed, incomplete, or ambiguous, choose needs_review.
```

### DirectorAgent Prompt

System role: short-drama director.

Task:

- Adapt the approved story context and episode plan into a short-drama script.
- Follow the `DirectorAssignment` exactly; adapt only the assigned story or assigned story batch.
- Preserve the original conflict and character relationships.
- Convert exposition into action and dialogue.
- Return strict JSON matching `ScriptEpisode`.

Important instruction:

```text
Do not solve unresolved story threads unless the episode plan says this episode resolves them. Do not include neighboring stories unless the assignment explicitly includes their story IDs.
```

### StoryboardPromptAgent Prompt

System role: storyboard prompt planner.

Task:

- Convert an accepted `ScriptEpisode` into selected storyboard frame prompts.
- Apply the `storyboard-visual-planner` skill to produce the 16:9 film production board / visual planning prompt.
- Use visual details from `StoryAssetPack` to preserve continuity.
- Keep each frame connected to a scene number, narrative beat, and source reference.
- Return strict JSON matching `StoryboardPromptPack`.

Important instruction:

```text
Do not generate images. Prepare storyboard/image prompts only. Do not invent visual continuity details when the asset pack marks a description as thin or missing; instead keep the prompt conservative and reference the missing detail in the frame notes or negative prompt.
```

### VideoPromptAgent Prompt

System role: video prompt planner.

Task:

- Convert an accepted `ScriptEpisode` and its `StoryboardPromptPack` into video prompt clips.
- Follow the provided video skill profile when one is available.
- Preserve continuity from `StoryAssetPack` and storyboard frame prompts.
- Keep each clip connected to scene numbers, storyboard frame numbers, and source references.
- Return strict JSON matching `VideoPromptPack`.

Important instruction:

```text
Do not generate videos. Prepare video-generation prompts only. If no video skill profile is provided yet, produce model-agnostic prompts and leave targetSkill unspecified.
```

### Asset Agent Prompt

System role: story asset extraction specialist.

Task:

- Extract only assets that appear in or are strongly supported by this approved story segment.
- Include confidence and source evidence for every asset.
- Generate a concise visual description.
- Self-check whether the visual description is sufficient for later image prompt generation.
- Generate a model-agnostic `visualPrompt` draft.

Important instruction:

```text
Do not invent visual details just to make the prompt richer. If the source lacks detail, mark descriptionQuality as thin or missing and set needsDescriptionRepair to true.
```

## Error Handling

- If chapter analysis fails for a chapter, mark all adjacent boundaries involving that chapter as `needs_review`.
- If LLM JSON parsing fails, retry with a repair prompt once, then create a review item or flagged script issue.
- If boundary verification fails, do not emit an approved story segment for that range.
- If an asset agent finds weak evidence, emit the asset as `candidate` with confidence rather than blocking the story.
- If an asset lacks a usable description, emit it with `needsDescriptionRepair: true` and add an `AssetWarning`.
- If director generation fails for one episode, keep other episode plans and mark the failed episode in a script issue file.
- If storyboard prompt generation fails for one episode, keep the accepted script and write a prompt issue entry for that episode.
- If video prompt generation fails for one episode, keep the accepted script and storyboard prompts, then write a video prompt issue entry for that episode.

## Testing Strategy

Unit tests:

- Boundary decision parsing.
- Review queue creation for low-confidence decisions.
- Story segment assembly from known boundary decisions.
- Context pack generation from approved segments only.
- Character, scene, and prop asset files include confidence, evidence snippets, description quality, and visual prompt fields.
- Thin or missing asset descriptions create warnings without blocking output.
- Episode plan validation.
- Director assignments only reference approved story segments and keep multi-story outputs separated by story ID.
- Storyboard prompt packs include frame numbers, scene references, shot types, source references, and continuity links to assets.
- Video prompt packs include clip numbers, scene references, storyboard frame references, duration, motion, camera movement, continuity notes, and source references.

Fixture tests:

- A small multi-chapter novel fixture where chapters 1-3 are one story and chapter 4 begins a new story.
- A fixture with ambiguous boundary requiring review.
- A fixture where one long story segment produces multiple episodes.
- A fixture where one accepted script episode produces opening, escalation, prop insert, reaction, and ending-button storyboard prompt frames.
- A fixture where storyboard prompt frames become short video prompt clips without invoking a video generation skill.

Verification commands:

```text
pnpm --filter @novel-agent/story-arcs build
pnpm test -- story-arcs
```

## First Implementation Scope

Implement the backend-only file pipeline:

1. Add the story segmentation and director data types.
2. Add JSON IO helpers under `story-arcs`.
3. Add deterministic segment assembly from boundary decisions.
4. Add story-level character, scene, and prop asset agents.
5. Add asset self-check and visual prompt preparation fields.
6. Add director assignment contracts so the user or scheduler controls which story scope the director handles.
7. Add LLM-backed chapter analysis, boundary judging, episode planning, and director generation.
8. Add storyboard prompt pack generation after accepted scripts.
9. Add skill-ready video prompt pack generation after storyboard prompts.
10. Add review queue output.
11. Add tests for boundary safety, approved-only context pack generation, non-blocking asset warnings, director assignment scope, storyboard prompt contracts, and video prompt contracts.

Frontend review screens and database persistence can be added after the file workflow is stable.
