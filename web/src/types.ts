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

/** 完整数据包下载状态。 */
export type DownloadState = 'not-prepared' | 'preparing' | 'ready' | 'needs-update' | 'failed';

export interface BookDownloadState {
  bookId: string;
  state: DownloadState;
  snapshotId?: string;
  progress?: number;
  snapshotVersion?: number;
  readyAt?: string;
  bytes?: number;
  failureReason?: string;
  message?: string;
}

/** 一套显著服饰/装扮；一个角色在不同场景/章节可有多套。 */
export interface Outfit {
  description: string;
  scene?: string;
  firstChapter?: number;
  lastChapter?: number;
}

/** 道具持有者；道具可易主，故为复数。 */
export interface Owner {
  name: string;
  canonicalName?: string;
  firstChapter?: number;
  lastChapter?: number;
  note?: string;
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
  /** 角色的多套服饰/装扮（与后端 core/types.ts Outfit 对齐） */
  outfits?: Outfit[] | string;
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
  /** 道具的持有者列表（与后端 core/types.ts Owner 对齐） */
  owners?: Owner[] | string;
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

/** 结构化证据片段（与后端 DescriptionEvidenceSnippet 对齐） */
export interface DescriptionEvidenceSnippet {
  chapterIndex: number;
  chapterTitle?: string;
  text: string;
  matchedNames: string[];
  otherMatchedNames?: string[];
  fields: string[];
}

export interface FusedDescriptionEntry {
  entityType: string;
  name: string;
  aliases: string[];
  sourceDescription?: string;
  fields?: Record<string, string>;
  missingFields?: string[];
  evidenceSnippets?: DescriptionEvidenceSnippet[];
  sourceCoverage?: string;
  confidence?: number;
  needsReview?: boolean;
}

export interface VisualDescriptionEntry extends FusedDescriptionEntry {
  tier?: string;
  importanceScore?: number;
  visualFields?: Record<string, string>;
  visualDetails?: Record<string, string>;
  /** LLM 生成的概括性视觉描写段落 */
  enhancedDescription?: string;
  /** 最终使用的视觉描写（= enhancedDescription 或其 fallback） */
  finalDescription?: string;
  llmSupplement?: string;
  completionStatus?: string;
  descriptionSource?: string;
}

/** 单个年龄阶段的提示词版本（人物描写可溯源） */
export interface PromptVariantEntry {
  stage: string;
  label: string;
  prompt: string;
  outfit?: string;
  /** 溯源：该版本基于的原文章节区间 */
  sourceChapters?: string;
  /** 其余服饰套系（含章节区间） */
  outfitList?: string[];
  source?: string;
  isPrimary?: boolean;
}

export interface GenerationPromptEntry {
  entityName: string;
  entityType: string;
  tier?: string;
  prompt: string;
  /** 角色的多个年龄阶段版本（仅 character；顶层 prompt = 主阶段） */
  variants?: PromptVariantEntry[];
  detectedStages?: string[];
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

export type ConcurrencyMode = 'parallel-books' | 'single-book-speed';

export interface ConcurrencyStatus {
  mode: ConcurrencyMode;
  keyCount: number;
  workers: number;
  recommended: number;
}

// —— 实体图片生成 ——

/** 单张实体图片元数据（画廊，DB 持久化）。 */
export interface EntityImageMeta {
  id: string;
  entityType: EntityType;
  entityName: string;
  mime: string;
  ext: string;
  bytes: number;
  aspectRatio: string | null;
  source: 'generated' | 'uploaded';
  stage: string | null;
  isPrimary: boolean;
  createdAt: string;
}

/** @deprecated 旧名兼容，等同 EntityImageMeta。 */
export type EntityImageResult = EntityImageMeta;

export interface ImageGenerationError {
  error: string;
  code: string;
}

export interface LlmStatus {
  provider: string;
  configured: boolean;
  canExtract: boolean;
  keyHint: string;
  /** 多 key 的 mask 列表（每个 key 一个） */
  keyHints?: string[];
  /** 当前配置的 key 数量 */
  keyCount?: number;
  baseUrl: string;
  model: string;
  concurrency?: ConcurrencyStatus;
  timestamp: string;
  error?: string;
  /** 保存配置后自动连接测试失败的提示（仅 PATCH /llm/config 响应可能携带） */
  warning?: string;
}

export interface ImageStatus {
  provider: string;
  configured: boolean;
  keyHint: string;
  baseUrl: string;
  model: string;
  size: string;
  characterRatio: string;
  itemRatio: string;
  locationRatio: string;
  timestamp: string;
  error?: string;
}

// —— 公共素材库 ——

/** 公共素材图片信息（含签名 URL） */
export interface PublicAssetImage {
  id: string;
  objectKey: string;
  mime: string;
  bytes: number;
  aspectRatio: string | null;
  stage: string | null;
  isPrimary: boolean;
  url: string;
}

/** 公共素材列表项（列表页用，不含 payload 全文） */
export interface PublicAssetListItem {
  id: string;
  publisherId: string;
  publisherName: string;
  kind: EntityType;
  name: string;
  summary: string | null;
  tags: string[];
  takenCount: number;
  createdAt: string;
  primaryImageUrl: string | null;
  status?: string;
}

/** 公共素材详情 */
export interface PublicAssetDetail {
  id: string;
  publisherId: string;
  publisherName: string;
  kind: EntityType;
  name: string;
  summary: string | null;
  tags: string[];
  payload: {
    name?: string;
    aliases?: string[];
    description?: string | null;
    visualDetails?: Record<string, string> | null;
    enhancedDescription?: string | null;
    promptVariants?: Array<{
      stage?: string;
      label?: string;
      prompt?: string;
      isPrimary?: boolean;
    }>;
    sourceBookTitle?: string;
  };
  takenCount: number;
  createdAt: string;
  images: PublicAssetImage[];
}
