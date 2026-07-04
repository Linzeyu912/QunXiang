export type EntityType = 'character' | 'location' | 'item';

export type BookStatus = 'UPLOADED' | 'EXTRACTING' | 'EXTRACTED' | 'FAILED';
export type EntityStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type Tier = 'core' | 'supporting' | 'candidate' | 'archived';

export interface Book {
  id: string;
  title: string;
  filePath: string;
  fileSize: number;
  mimeType: string;
  status: BookStatus;
  userId: string;
  createdAt: string;
  updatedAt?: string;
}

interface EntityBase {
  id: string;
  bookId: string;
  name: string;
  aliases: string[] | string;
  description?: string | null;
  confidence: number;
  status: EntityStatus;
  chapterRef?: string | null;
  firstChapter?: number | null;
  lastChapter?: number | null;
  chapterAppearances: number[] | string;
  mentionCount: number;
  createdAt: string;
  updatedAt?: string;
}

export interface Character extends EntityBase {
  dialogueCount: number;
  coCharacters: string[] | string;
}

export interface LocationEntity extends EntityBase {
  importanceScore: number;
  tier: Tier;
  storyScore: number;
  productionScore: number;
  pillarCausal: number;
  pillarUniqueness: number;
  pillarTransition: number;
}

export interface ItemEntity extends EntityBase {
  importanceScore: number;
  tier: Tier;
  storyScore: number;
  productionScore: number;
  pillarCausal: number;
  pillarUniqueness: number;
  pillarTransition: number;
}

export type AnyEntity = Character | LocationEntity | ItemEntity;

export type AgentType =
  | 'extractor'
  | 'validator'
  | 'entity-resolution'
  | 'description-fusion'
  | 'visual-description'
  | 'prompt-generation'
  | 'reviewer';

export type StageStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface ExtractionStageInfo {
  id: string;
  name: string;
  weight: number;
  status: StageStatus;
  startedAt?: string;
  completedAt?: string;
  message?: string;
}

export interface ExtractionStagesResult {
  bookId: string;
  overallProgress: number;
  isRunning: boolean;
  isComplete: boolean;
  isFailed: boolean;
  stages: ExtractionStageInfo[];
}

export interface CharacterReview {
  id: string;
  characterId: string;
  userId: string;
  action: 'APPROVED' | 'REJECTED' | 'EDITED';
  previousValue?: string;
  newValue?: string;
  createdAt: string;
}

// —— 提取富产物（output/{run}/entities/ 下的三层文件，见 api/src/services/artifacts.service.ts）——

export interface FusedDescriptionEntry {
  entityType: string;
  name: string;
  aliases: string[];
  sourceDescription?: string;
  fields?: Record<string, string>;
  missingFields?: string[];
  evidenceSnippets?: string[];
  sourceCoverage?: string;
  confidence?: number;
  needsReview?: boolean;
}

export interface VisualDescriptionEntry extends FusedDescriptionEntry {
  tier?: string;
  importanceScore?: number;
  visualFields?: Record<string, string>;
  visualDetails?: Record<string, string>;
}

export interface GenerationPromptEntry {
  entityName: string;
  entityType: string;
  tier?: string;
  prompt: string;
  styleTags?: string[];
  source?: string;
  quality?: string;
  description?: string;
}

export interface EntityArtifacts {
  description?: FusedDescriptionEntry;
  visual?: VisualDescriptionEntry;
  prompt?: GenerationPromptEntry;
}

export interface NarrativeEventEntry {
  text: string;
  chapterIndex: number;
  position?: number;
  source?: string;
  confidence?: number;
  totalCount?: number;
  allChapters?: number[];
}

export interface ExtractionArtifactsResponse {
  available: boolean;
  runDir?: string;
  generatedAt?: string;
  summaryMd?: string;
  allPromptsMd?: string;
  events: NarrativeEventEntry[];
  characters: Record<string, EntityArtifacts>;
  locations: Record<string, EntityArtifacts>;
  items: Record<string, EntityArtifacts>;
}

export interface ChapterOutlineResponse {
  bookId: string;
  title: string;
  chapterMode: string;
  isFallback: boolean;
  removedNoiseLines: number;
  suspectLinesTotal: number;
  byCategory: Record<string, number>;
  suspectLines: ChapterNoiseLine[];
  chapters: Array<{ index: number; title?: string; wordCount: number }>;
}

export type NoiseCategory = 'url' | 'promo' | 'template' | 'decoration' | 'repeated' | 'garbled' | 'meta';

export interface ChapterNoiseLine {
  lineNum: number;
  content: string;
  category: NoiseCategory;
  confidence: number;
  removed: boolean;
  /** 已被人工「找回」（从删除集合中排除） */
  restored?: boolean;
}

/** 单章清洗后内容响应（正文 + 噪声行高亮标记）。 */
export interface ChapterContentResponse {
  bookId: string;
  chapterIndex: number;
  title?: string;
  /** 该章正文（规范化后、未清洗，含被标记噪声行的完整文本） */
  content: string;
  /** 该章第 1 行对应的全文 1-based 行号 */
  startLineNum: number;
  /** 该章涉及的噪声行明细 */
  noiseLines: ChapterNoiseLine[];
}

export interface ExtractionRunInfo {
  runDir: string;
  generatedAt: string;
  status?: string;
  counts?: { characters?: number; locations?: number; items?: number };
  isCurrent: boolean;
}

export type PrescanEntityType = 'character' | 'location' | 'item' | 'event';

export interface PrescanMentionLine {
  chapterIndex: number;
  text: string;
  source: string;
  confidence: number;
}

export interface PrescanMentionFile {
  totalCount: number;
  sample: PrescanMentionLine[];
}

export interface PrescanImportanceRow {
  text: string;
  importance: number;
  confidence: number;
  tier: string;
  route: string;
  causal: number;
  uniqueness: number;
  transition: number;
  storyScore: number;
  storyValue: number;
  productionValue: number;
  mentionCount: number;
  chapters: number[];
}

export interface PrescanImportanceSection {
  type: PrescanEntityType;
  rows: PrescanImportanceRow[];
  tierSummary?: string;
  routeSummary?: string;
}

export interface PrescanImportanceReport {
  sections: PrescanImportanceSection[];
  rawPreview: string;
}

export interface PrescanArtifactsResponse {
  available: boolean;
  runDir?: string;
  generatedAt?: string;
  intermediateDir?: string;
  files: Record<PrescanEntityType, PrescanMentionFile>;
  importance?: PrescanImportanceReport;
}

export interface LlmStatus {
  provider: string;
  configured: boolean;
  canExtract: boolean;
  keyHint: string;
  baseUrl: string;
  model: string;
  timestamp: string;
  error?: string;
}
