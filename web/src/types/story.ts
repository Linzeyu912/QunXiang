// 单一事实来源：story-arcs/src/types.ts（经 tsconfig paths 映射为
// @novel-agent/story-arcs/types，只指向零依赖的纯类型文件）。
// 禁止从 @novel-agent/story-arcs 包根导入：包根会拖入 Node fs 依赖的源码图。
export type {
  StorySegment,
  StoryConflictStatus,
  NarrativeEvent,
  NarrativeArcType,
  CharacterInStory,
  SceneInStory,
  PropInStory,
  StoryAssetPack,
  AssetWarning,
  StoryAssetStatus,
  DescriptionQuality,
  StoryAssetPromptPack,
  StoryAssetVisualPrompt,
  DirectorAssignment,
  ScriptEpisodePlan,
  ScriptEpisode,
  ScriptScene,
  ScriptDialogueLine,
  ScriptReview,
  StoryboardPromptPack,
  StoryboardFramePrompt,
  VideoPromptPack,
  VideoClipPrompt,
} from '@novel-agent/story-arcs/types';

import type { DirectorAssignment, ScriptEpisode, ScriptEpisodePlan, ScriptReview, StorySegment } from '@novel-agent/story-arcs/types';

// —— 以下为 API 层扩展类型，与 api/src/services/story.service.ts 一一对应 ——

/** 列表用摘要：不含 sourceText，附加产物存在性标记 */
export type StorySummary = Omit<StorySegment, 'sourceText'> & {
  assetsExtracted: boolean;
  directorRan: boolean;
};

export interface StoriesListResponse {
  stories: StorySummary[];
  pendingBoundaryReviews: number;
  generatedAt: string | null;
}

export type BoundaryDecision = 'confirm' | 'merge_with_previous';

export interface BoundaryReviewItem {
  id: string;
  bookId: string;
  segmentId: string;
  betweenChapter: [number, number];
  suggestedDecision: BoundaryDecision;
  confidence: number;
  reason: string;
  leftSummary: string;
  rightSummary: string;
  evidence: {
    sharedCharacters: string[];
    leftCharacters: string[];
    rightCharacters: string[];
    arcType?: string;
    turningPoints: string[];
  };
  canMerge: boolean;
  status: 'pending' | 'resolved';
  resolvedDecision?: BoundaryDecision;
}

export interface StoryTask {
  id: string;
  bookId: string;
  kind: 'segment';
  status: 'running' | 'completed' | 'failed';
  stage?: string;
  message?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoryPipelineEvent {
  type: 'snapshot' | 'stage-started' | 'stage-completed' | 'review-needed' | 'done' | 'error';
  taskId?: string;
  stage?: string;
  message?: string;
  pendingCount?: number;
  task?: StoryTask | null;
  timestamp: number;
}

export interface AssignmentWithStatus extends DirectorAssignment {
  status: 'completed' | 'failed';
  error?: string;
}

export interface CreateAssignmentBody {
  assignmentType: DirectorAssignment['assignmentType'];
  storyIds: string[];
  objective: DirectorAssignment['objective'];
  styleNotes?: string[];
  constraints?: string[];
  episodeNos?: number[];
}

export interface EpisodesResponse {
  hasDirectorRun: boolean;
  plans: ScriptEpisodePlan[];
  episodes: ScriptEpisode[];
  review: ScriptReview | null;
}

export interface PromptPackResponse<T> {
  pack: T | null;
  reason?: 'not_generated' | 'review_blocked';
  review?: ScriptReview | null;
}

export type StoryAssetType = 'character' | 'scene' | 'prop';

export interface AssetPatch {
  description?: string;
  visualPrompt?: string;
  appearanceDescription?: string;
}
