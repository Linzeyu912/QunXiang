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

  createdAt: Date;
  updatedAt?: Date;
}

export interface User {
  id: string;
  email: string;
  name: string;
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
