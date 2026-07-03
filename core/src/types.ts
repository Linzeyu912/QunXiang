// Entity Types
export interface Book {
  id: string;
  title: string;
  filePath: string;
  fileSize: number;
  mimeType: string;
  status: 'UPLOADED' | 'EXTRACTING' | 'EXTRACTED' | 'FAILED';
  userId: string;
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
  coCharacters: string[];

  // 该角色的所有显著服饰套系（提取阶段结构化抓取，带章节区间）
  outfits: Outfit[];
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

  createdAt: Date;
  updatedAt?: Date;
}

export interface Item {
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

  // 该道具的持有者（提取阶段结构化抓取，带章节区间；道具可易主）
  owners: Owner[];

  createdAt: Date;
  updatedAt?: Date;
}

export interface User {
  id: string;
  email: string;
  name: string;
  passwordHash?: string | null;
  createdAt: Date;
}

export interface CharacterReview {
  id: string;
  characterId: string;
  userId: string;
  action: 'APPROVED' | 'REJECTED' | 'EDITED';
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
