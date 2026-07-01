export type AgentType = 'extractor' | 'validator' | 'entity-resolution'
  | 'description-fusion' | 'visual-description' | 'prompt-generation' | 'reviewer';

export interface AgentPayload {
  bookId: string;
  userId?: string;
  [key: string]: unknown;
}

export interface AgentResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface AgentContext {
  payload: AgentPayload;
  previousResults?: unknown[];
  attempts: number;
}

export interface OrchestratorConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_ORCHESTRATOR_CONFIG: OrchestratorConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
};
