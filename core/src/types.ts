// Entity Types
export interface Book {
  id: string;
  title: string;
  filePath: string;
  fileSize: number;
  mimeType: string;
  status: 'UPLOADED' | 'EXTRACTING' | 'EXTRACTED' | 'FAILED' | 'SEED_PREPARING';
  userId: string;
  /** 来源：UPLOAD | SEED | SHARED_COPY */
  sourceType?: 'UPLOAD' | 'SEED' | 'SHARED_COPY';
  /** 原文/噪声覆盖版本号，变化时 +1 */
  sourceRevision?: number;
  /** 等于 sourceRevision 才允许启动提取 */
  preprocessConfirmedRevision?: number | null;
  currentExtractionSessionId?: string | null;
  onboardingFeatured?: boolean;
  sourceObjectKey?: string | null;
  currentSnapshotId?: string | null;
  createdAt: Date;
  updatedAt?: Date;
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
  /** 经角色消解回填的规范角色名（提取阶段只填 name）。 */
  canonicalName?: string;
  firstChapter?: number;
  lastChapter?: number;
  note?: string;
}

export interface Character {
  id: string;
  bookId: string;
  name: string;
  aliases: string[];
  description?: string;
  confidence: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  chapterRef?: string;
  createdAt: Date;
  updatedAt?: Date;

  // 新增字段：用于重要性评估
  firstChapter?: number;
  lastChapter?: number;
  chapterAppearances: number[];
  mentionCount: number;
  dialogueCount: number;
  /** 首次出现处的原文片段（前后各约30字），供低置信度库人工判断参考 */
  firstMentionSnippet?: string;
  coCharacters: string[];

  // 该角色的所有显著服饰套系（提取阶段结构化抓取，带章节区间）
  outfits: Outfit[];

  // 年龄成长阶段（child/youth/young/middle/old）：按原文证据识别，
  // ageStages 为跨越的全部阶段，primaryAgeStage 为当前主阶段。
  ageStages?: string[];
  primaryAgeStage?: string;
  // —— 审核与人工保护（phase10）——
  /** 实体稳定键：跨提取运行保持不变 */
  stableKey?: string;
  /** 审核来源：AI | IMPORTED | USER */
  reviewSource?: 'AI' | 'IMPORTED' | 'USER';
  /** 用户编辑过、重新提取不得覆盖的字段名 */
  lockedFields?: string[];
  /** 乐观版本号，每次审核/编辑 +1 */
  version?: number;
  missingFromLatestRun?: boolean;
  archivedAt?: Date | null;
  lastSeenExtractionSessionId?: string | null;
}

export interface Location {
  id: string;
  bookId: string;
  name: string;
  aliases: string[];
  description?: string;
  confidence: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  chapterRef?: string;

  // 重要性评估字段
  importanceScore: number;
  tier: 'core' | 'supporting' | 'candidate' | 'archived';
  storyScore: number;
  productionScore: number;
  pillarCausal: number;
  pillarUniqueness: number;
  pillarTransition: number;
  mentionCount: number;
  firstChapter?: number;
  lastChapter?: number;
  chapterAppearances: number[];
  /** 首次出现处的原文片段（前后各约30字），供低置信度库人工判断参考 */
  firstMentionSnippet?: string;

  createdAt: Date;
  updatedAt?: Date;
  // —— 审核与人工保护（phase10）——
  /** 实体稳定键：跨提取运行保持不变 */
  stableKey?: string;
  /** 审核来源：AI | IMPORTED | USER */
  reviewSource?: 'AI' | 'IMPORTED' | 'USER';
  /** 用户编辑过、重新提取不得覆盖的字段名 */
  lockedFields?: string[];
  /** 乐观版本号，每次审核/编辑 +1 */
  version?: number;
  missingFromLatestRun?: boolean;
  archivedAt?: Date | null;
  lastSeenExtractionSessionId?: string | null;
}

export interface Item {
  id: string;
  bookId: string;
  name: string;
  aliases: string[];
  /** 道具大类：weapon 武器/skill 技能功法/food 食物/pill 丹药消耗品/treasure 法宝器物/electronics 电子设备/document 文件信物/other 其他 */
  category?: ItemCategory;
  description?: string;
  confidence: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  chapterRef?: string;

  // 重要性评估字段
  importanceScore: number;
  tier: 'core' | 'supporting' | 'candidate' | 'archived';
  storyScore: number;
  productionScore: number;
  pillarCausal: number;
  pillarUniqueness: number;
  pillarTransition: number;
  mentionCount: number;
  firstChapter?: number;
  lastChapter?: number;
  chapterAppearances: number[];
  /** 首次出现处的原文片段（前后各约30字），供低置信度库人工判断参考 */
  firstMentionSnippet?: string;

  // 该道具的持有者（提取阶段结构化抓取，带章节区间；道具可易主）
  owners: Owner[];

  createdAt: Date;
  updatedAt?: Date;
  // —— 审核与人工保护（phase10）——
  /** 实体稳定键：跨提取运行保持不变 */
  stableKey?: string;
  /** 审核来源：AI | IMPORTED | USER */
  reviewSource?: 'AI' | 'IMPORTED' | 'USER';
  /** 用户编辑过、重新提取不得覆盖的字段名 */
  lockedFields?: string[];
  /** 乐观版本号，每次审核/编辑 +1 */
  version?: number;
  missingFromLatestRun?: boolean;
  archivedAt?: Date | null;
  lastSeenExtractionSessionId?: string | null;
}

/** 道具大类（提取时由 LLM 判定，可在审核时修改）。 */
export type ItemCategory = 'weapon' | 'skill' | 'food' | 'pill' | 'treasure' | 'electronics' | 'document' | 'other';

/** 世界观/体系设定类别：世界观背景、力量体系、境界等级、组织势力、规则法则。 */
export type WorldviewCategory = 'worldview' | 'power-system' | 'realm' | 'faction' | 'rule';

/** 世界观与体系设定实体。 */
export interface WorldviewSetting {
  id: string;
  bookId: string;
  name: string;
  aliases: string[];
  category: WorldviewCategory;
  description?: string;
  confidence: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  chapterRef?: string;
  importanceScore: number;
  tier: 'core' | 'supporting' | 'candidate' | 'archived';
  mentionCount: number;
  firstChapter?: number;
  lastChapter?: number;
  chapterAppearances: number[];
  createdAt: Date;
  updatedAt?: Date;
  // —— 审核与人工保护（phase10）——
  /** 实体稳定键：跨提取运行保持不变 */
  stableKey?: string;
  /** 审核来源：AI | IMPORTED | USER */
  reviewSource?: 'AI' | 'IMPORTED' | 'USER';
  /** 用户编辑过、重新提取不得覆盖的字段名 */
  lockedFields?: string[];
  /** 乐观版本号，每次审核/编辑 +1 */
  version?: number;
  missingFromLatestRun?: boolean;
  archivedAt?: Date | null;
  lastSeenExtractionSessionId?: string | null;
}

export interface User {
  id: string;
  email: string;
  emailNormalized: string;
  name: string;
  passwordHash: string;
  status: 'ACTIVE' | 'DISABLED';
  shareCodeHash: string;
  createdAt: Date;
}

export type VisualSpecStatus = 'ACTIVE' | 'SUPERSEDED';
export type VisualSpecEntityType = 'character' | 'location' | 'item';

/** 可被下游钉死引用的视觉规格（prompt + 变体 + 版本 + 主图）。 */
export interface VisualSpec {
  id: string;
  bookId: string;
  entityType: VisualSpecEntityType;
  entityName: string;
  variantKey: string;
  version: number;
  status: VisualSpecStatus;
  prompt: string;
  promptSource: string;
  quality?: string | null;
  styleTags: string[];
  model?: string | null;
  primaryImageId?: string | null;
  sourceChapters?: string | null;
  payload: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface CharacterReview {
  id: string;
  characterId: string;
  userId: string;
  action: 'APPROVED' | 'REJECTED' | 'EDITED' | 'MERGE_ACCEPTED' | 'MERGE_REJECTED';
  previousValue?: string;
  newValue?: string;
  createdAt: Date;
}

export interface ExtractionSession {
  id: string;
  bookId: string;
  userId: string;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  createdAt: Date;
  completedAt?: Date;
}

// Agent Types
export type AgentType =
  | 'extractor'
  | 'validator'
  | 'entity-resolution'
  | 'description-fusion'
  | 'visual-description'
  | 'prompt-generation'
  | 'reviewer';

// Task Type (for scheduler)
export interface Task {
  id: string;
  bookId: string;
  agentType: AgentType;
  payload: unknown;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'dead_lettered';
  result?: unknown;
  error?: string;
  retryCount?: number;
  deadLettered?: boolean;
  failedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// Pipeline Types
export interface PipelineConfig {
  agents: AgentType[];
  maxRetries?: number;
  timeout?: number;
}

/**
 * 低置信度实体阈值：置信度低于该值的待审核实体进入「低置信度库」，
 * 不进入主审核列表，也不参与视觉补写/提示词生成等补写管线（只保留名字防遗漏）。
 * 已通过（APPROVED）的实体不受影响。
 */
export const LOW_CONFIDENCE_THRESHOLD = 0.6;

/** 判断实体是否属于低置信度库（低置信度且仍处于待审核 PENDING 状态）。 */
export function isLowConfidenceEntity(entity: { confidence: number; status: string }): boolean {
  return entity.confidence < LOW_CONFIDENCE_THRESHOLD && entity.status === 'PENDING';
}

/** 证据校准的输入信号（dialogueCount 仅角色有）。 */
export interface ConfidenceEvidence {
  /** 全文提及次数（主名 + 别名合计） */
  mentionCount: number;
  /** 出现的不同章节数 */
  chapterCount: number;
  /** 对话次数（仅角色） */
  dialogueCount?: number;
  /** 全书总章节数：提供时章节覆盖按书长归一（覆盖过半得满分），
   *  缺省回退到 10 章绝对刻度（兼容回填脚本等无总章数的场景） */
  totalChapters?: number;
}

/**
 * 用文本证据校准 LLM 自报置信度。
 *
 * 背景：LLM 自报置信度普遍虚高且缺乏区分度——实测主角和仅出现一次的
 * 路人角色都集中在 0.85~0.95，直接落库会让「低置信度库」几乎永远为空。
 * 这里把自报值（作为先验，压缩到 [0.3, 0.95]）与证据分按 45:55 混合：
 * 证据分由提及次数（对数饱和，16 次封顶）、章节覆盖（提供总章数时按
 * 书长归一——覆盖全书一半章节即得满分，否则 10 章绝对刻度）、对话次数
 * （8 次封顶，仅角色）加权得出。校准后：
 * - 仅出现 1~2 次的边缘实体即使自报 0.9 也会落到 0.6 以下，进入低置信度库；
 * - 高频、跨章的核心实体仍维持在 0.85+。
 */
export function calibrateConfidence(llm: number | undefined, ev: ConfidenceEvidence): number {
  const mention = Math.min(1, Math.log2(1 + Math.max(0, ev.mentionCount)) / Math.log2(17));
  const chapter = ev.totalChapters && ev.totalChapters > 0
    ? Math.min(1, Math.max(0, ev.chapterCount) / Math.max(1, Math.ceil(ev.totalChapters / 2)))
    : Math.min(1, Math.max(0, ev.chapterCount) / 10);
  const evidence =
    ev.dialogueCount != null
      ? mention * 0.45 + chapter * 0.25 + (Math.min(1, Math.max(0, ev.dialogueCount) / 8)) * 0.3
      : mention * 0.6 + chapter * 0.4;
  const base = Math.min(0.95, Math.max(0.3, llm ?? 0.7));
  // 保留三位小数，避免落库出现 0.6499999 这类浮点尾数
  return Math.round((base * 0.45 + evidence * 0.55) * 1000) / 1000;
}
