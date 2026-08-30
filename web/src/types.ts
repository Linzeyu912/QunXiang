export type EntityType = 'character' | 'location' | 'item' | 'worldview';

export type BookStatus = 'UPLOADED' | 'EXTRACTING' | 'EXTRACTED' | 'FAILED' | 'SEED_PREPARING';
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
  /** 书籍来源：UPLOAD=普通上传 | SEED=示例书 | SHARED_COPY=分享副本 */
  sourceType?: 'UPLOAD' | 'SEED' | 'SHARED_COPY';
  sourcePackageId?: string | null;
  sourcePackageVersion?: string | null;
  /** 书架「体验示例」分区展示 */
  onboardingFeatured?: boolean;
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
  /** 首次出现处的原文片段（低置信度库人工判断参考） */
  firstMentionSnippet?: string | null;
  createdAt: string;
  updatedAt?: string;
}

export interface Character extends EntityBase {
  dialogueCount: number;
  coCharacters: string[] | string;
  /** 角色的多套服饰/装扮（与后端 core/types.ts Outfit 对齐） */
  outfits?: Outfit[] | string;
  /** 年龄成长阶段（child/youth/young/middle/old，按原文证据识别） */
  ageStages?: string[] | string;
  primaryAgeStage?: string | null;
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

/** 道具大类（提取时由 LLM 判定，可在审核时修改） */
export type ItemCategory = 'weapon' | 'skill' | 'food' | 'pill' | 'treasure' | 'electronics' | 'document' | 'other';

/** 道具大类中文标签（列表/详情/筛选共用） */
export const ITEM_CATEGORY_LABEL: Record<ItemCategory, string> = {
  weapon: '武器',
  skill: '技能功法',
  food: '食物',
  pill: '丹药消耗品',
  treasure: '法宝器物',
  electronics: '电子设备',
  document: '文件信物',
  other: '其他物品',
};

export interface ItemEntity extends EntityBase {
  importanceScore: number;
  tier: Tier;
  storyScore: number;
  productionScore: number;
  pillarCausal: number;
  pillarUniqueness: number;
  pillarTransition: number;
  /** 道具大类：武器/技能功法/食物/丹药消耗品/法宝器物/其他 */
  category?: ItemCategory;
  /** 道具的持有者列表（与后端 core/types.ts Owner 对齐） */
  owners?: Owner[] | string;
}

/** 世界观/体系设定类别。 */
export type WorldviewCategory = 'worldview' | 'power-system' | 'realm' | 'faction' | 'rule';

/** 世界观与体系设定实体。 */
export interface WorldviewEntity extends EntityBase {
  category: WorldviewCategory;
  importanceScore: number;
  tier: Tier;
}

export type AnyEntity = Character | LocationEntity | ItemEntity | WorldviewEntity;

/** 实体公共审核字段（phase10）：所有实体类型都可能携带。 */
export interface EntityAuditFields {
  stableKey?: string;
  reviewSource?: 'AI' | 'IMPORTED' | 'USER';
  lockedFields?: string[];
  version?: number;
  /** 最新一轮提取未再出现该实体（人工审核过的实体保留时的风险提示） */
  missingFromLatestRun?: boolean;
  archivedAt?: string | null;
}

/** 世界观体系梳理结果。 */
export interface WorldviewSynthesis {
  overview: string | null;
  cultivationSystem: {
    summary: string;
    details?: string | null;
    levels: Array<{ name: string; totalLevels?: string | null; description: string }>;
  } | null;
  factions: {
    summary: string;
    groups: Array<{ name: string; description: string; relation?: string | null }>;
  } | null;
  rules: { summary: string; items: string[] } | null;
  geography: {
    summary: string;
    regions: Array<{ name: string; description: string }>;
  } | null;
  history: string | null;
}

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
  /** 阶段内进度详情（如提取阶段的批次进度："第 3/5 批"） */
  detail?: string;
}

export interface RunEstimate {
  inputChars: number;
  estimatedCalls: number;
  queuedAhead: number;
  historicalDurationMs: number | null;
  maxCalls: number;
  maxTokens: number | null;
}

export interface ExtractionRun {
  id: string;
  bookId: string;
  userId: string;
  status: string;
  kind: string;
  sourceRevision: number;
  startedAt?: string | null;
  completedAt?: string | null;
  pauseRequestedAt?: string | null;
  cancelledAt?: string | null;
  failureReason?: string | null;
  estimatedInputChars?: string | null;
  estimatedCalls?: number | null;
  maxCalls?: number | null;
  maxTokens?: number | null;
  promotedAt?: string | null;
  createdAt: string;
}

export interface ExtractionRunTasks {
  run: ExtractionRun | null;
  tasks: Array<{ id: string; agentType: string; status: string; startedAt?: string | null; completedAt?: string | null; failedAt?: string | null; error?: string | null }>;
}

export interface ExtractionStagesResult {
  bookId: string;
  overallProgress: number;
  isRunning: boolean;
  isComplete: boolean;
  isFailed: boolean;
  stages: ExtractionStageInfo[];
  imported?: boolean;
  importedMessage?: string;
  /** 提取阶段彻底失败的批次：对应章节实体缺失（如"第 12–15 章提取失败…"） */
  extractionWarnings?: string[];
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

/** 单套服饰（非主套）的完整四视图提示词（模板生成，可经 LLM 补写） */
export interface OutfitVariantEntry {
  /** 场景/用途标签（如 "伪装炼药师"） */
  scene?: string;
  /** 原文服饰描述 */
  description: string;
  /** 完整四视图提示词 */
  prompt: string;
  /** 溯源：该套出现的章节区间 */
  sourceChapters?: string;
  source?: string;
}

export interface GenerationPromptEntry {
  entityName: string;
  entityType: string;
  tier?: string;
  prompt: string;
  /** 角色的多个年龄阶段版本（仅 character；顶层 prompt = 主阶段） */
  variants?: PromptVariantEntry[];
  /** 非主套服饰套系的完整设计图提示词（仅 character） */
  outfitVariants?: OutfitVariantEntry[];
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
  /** 产物基于的原文版本与当前不一致时为 true（提示「基于旧版原文生成」） */
  outdatedRevision?: boolean;
  basedOnSourceRevision?: number;
  currentSourceRevision?: number;
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
  /** 原文中的替换字符（U+FFFD）数量（实施包 C2） */
  replacementCharCount?: number;
  removedNoiseLines: number;
  suspectLinesTotal: number;
  byCategory: Record<string, number>;
  suspectLines: ChapterNoiseLine[];
  chapters: Array<{ index: number; title?: string; wordCount: number }>;
}

export type NoiseCategory = 'url' | 'promo' | 'template' | 'decoration' | 'repeated' | 'garbled' | 'meta' | 'dialogue' | 'onomatopoeia' | 'short';

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
  /** 版权声明（实施包 H2） */
  licenseType?: 'original' | 'authorized' | 'public_domain' | null;
  attributionRequired?: boolean;
}
