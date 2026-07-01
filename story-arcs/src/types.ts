export interface StoryArcOptions {
  bookId: string;
  minChapterLength?: number;
  sceneChangeThreshold?: number;
}

export interface SceneMarker {
  type: 'dialogue' | 'description' | 'transition' | 'time_change' | 'location_change';
  position: number;
  confidence: number;
}

export type StoryConflictStatus = 'resolved' | 'partially_resolved' | 'ongoing';
export type StoryAssetStatus = 'confirmed' | 'candidate';
export type DescriptionQuality = 'sufficient' | 'thin' | 'missing';
export type NarrativeEventType =
  | 'conflict'
  | 'resource'
  | 'turning_point'
  | 'reveal'
  | 'goal'
  | 'training'
  | 'relationship'
  | 'travel'
  | 'worldbuilding'
  | 'other';
export type NarrativeEventFunction = 'setup' | 'inciting' | 'escalation' | 'turning_point' | 'resolution' | 'aftermath';
export type NarrativeArcType = 'conflict' | 'expedition' | 'reveal' | 'training' | 'relationship' | 'resource' | 'worldbuilding' | 'other';

export interface NarrativeEvent {
  id: string;
  chapterIndex: number;
  eventType: NarrativeEventType;
  function: NarrativeEventFunction;
  summary: string;
  participants: string[];
  trigger: string;
  consequence?: string;
  evidenceSnippet: string;
  confidence: number;
  source: 'regex' | 'llm' | 'heuristic';
}

export interface NarrativeArc {
  id: string;
  bookId: string;
  title: string;
  startChapter: number;
  endChapter: number;
  arcType: NarrativeArcType;
  goal?: string;
  coreConflict: string;
  events: NarrativeEvent[];
  confidence: number;
}

export interface StorySegment {
  id: string;
  bookId: string;
  arcId?: string;
  arcType?: NarrativeArcType;
  goal?: string;
  startChapter: number;
  endChapter: number;
  title: string;
  sourceText: string;
  summary: string;
  coreConflict: string;
  trigger: string;
  turningPoints: string[];
  resolution?: string;
  conflictStatus: StoryConflictStatus;
  events?: NarrativeEvent[];
  mainCharacters: string[];
  supportingCharacters: string[];
  locations: string[];
  boundaryConfidence: number;
  boundaryDecisionIds: string[];
  approved: boolean;
}

export interface StoryAssetBase {
  confidence: number;
  assetStatus: StoryAssetStatus;
  description: string;
  descriptionQuality: DescriptionQuality;
  needsDescriptionRepair: boolean;
  visualPrompt: string;
  evidenceSnippets: string[];
  sourceChapters: number[];
  sourceRangeHint?: string;
}

export interface CharacterInStory extends StoryAssetBase {
  name: string;
  aliases: string[];
  roleInStory: 'protagonist' | 'antagonist' | 'supporting' | 'minor';
  motivation: string;
  conflictRelation: string;
  firstMentionChapter: number;
  lastMentionChapter: number;
  keyActions: string[];
  appearanceDescription: string;
  appearanceEvidenceSnippets: string[];
  needsAppearanceRepair: boolean;
}

export interface SceneInStory extends StoryAssetBase {
  id: string;
  name: string;
  location: string;
  timeHint?: string;
  sourceRange: string;
  summary: string;
  conflictBeat: string;
  involvedCharacters: string[];
}

export interface PropInStory extends StoryAssetBase {
  name: string;
  aliases: string[];
  propType: 'weapon' | 'document' | 'token' | 'tool' | 'money' | 'other';
  storyFunction: string;
  ownerOrHolder?: string;
  firstAppearance: string;
  keyMoments: string[];
}

export interface AssetWarning {
  assetType: 'character' | 'scene' | 'prop';
  assetName: string;
  issue: 'missing_description' | 'thin_description' | 'low_confidence' | 'weak_evidence';
  message: string;
}

export interface StoryCharacterFile {
  storyId: string;
  bookId: string;
  characters: CharacterInStory[];
}

export interface StorySceneFile {
  storyId: string;
  bookId: string;
  scenes: SceneInStory[];
}

export interface StoryPropFile {
  storyId: string;
  bookId: string;
  props: PropInStory[];
}

export interface StoryAssetPack {
  storyId: string;
  bookId: string;
  characters: CharacterInStory[];
  scenes: SceneInStory[];
  props: PropInStory[];
  assetWarnings: AssetWarning[];
}

export type StoryAssetPromptType = 'character' | 'scene' | 'prop';

export interface StoryAssetVisualPrompt {
  assetType: StoryAssetPromptType;
  assetId: string;
  assetName: string;
  prompt: string;
  negativePrompt: string;
  descriptionQuality: DescriptionQuality;
  needsDescriptionRepair: boolean;
  evidenceSnippets: string[];
  sourceChapters: number[];
  sourceRangeHint?: string;
  metadata: Record<string, string | number | boolean | string[] | undefined>;
}

export interface StoryAssetPromptFile {
  storyId: string;
  bookId: string;
  prompts: StoryAssetVisualPrompt[];
}

export interface StoryAssetPromptPack {
  storyId: string;
  bookId: string;
  characterPrompts: StoryAssetVisualPrompt[];
  scenePrompts: StoryAssetVisualPrompt[];
  propPrompts: StoryAssetVisualPrompt[];
  allPrompts: StoryAssetVisualPrompt[];
}

export interface StoryAssetBundle {
  story: StorySegment;
  characters: StoryCharacterFile;
  scenes: StorySceneFile;
  props: StoryPropFile;
  assetPack: StoryAssetPack;
  assetPrompts: StoryAssetPromptPack;
}

export interface StoryAssetExtractionOptions {
  outputDir?: string;
  writeFiles?: boolean;
  /** Directory name for this book (defaults to bookId). Use bookSlug(title) for readable paths. */
  bookDirName?: string;
}

export interface StoryAssetExtractionResult {
  storyAssets: StoryAssetBundle[];
  skippedStoryIds: string[];
}

export interface DirectorAssignment {
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

export interface ScriptEpisodePlan {
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

export interface ScriptDialogueLine {
  speaker: string;
  line: string;
  emotion?: string;
}

export interface ScriptScene {
  sceneNo: number;
  location: string;
  characters: string[];
  action: string;
  dialogue: ScriptDialogueLine[];
  camera?: string;
}

export interface ScriptEpisode {
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

export interface ScriptReview {
  segmentId: string;
  episodeNo: number;
  accepted: boolean;
  issues: Array<{ severity: 'blocker' | 'warning'; message: string }>;
  notes: string[];
}

export interface StoryboardPromptPack {
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
  productionBoardPrompt: string;
}

export interface StoryboardFramePrompt {
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

export interface VideoPromptPack {
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

export interface VideoSkillProfile {
  skillName: string;
  version?: string;
  expectedFields: string[];
  notes?: string[];
}

export interface VideoClipPrompt {
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
