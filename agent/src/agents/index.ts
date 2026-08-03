import type { AgentPayload, AgentResult } from '../types.js';

export type AgentExecutor = (payload: AgentPayload) => Promise<AgentResult>;

export { executeExtractor } from './extractor.js';
export { executeValidator } from './validator.js';
export { executeResolution } from './resolution.js';
export { executeReviewer } from './reviewer.js';
export { ProducerAgent, createProducer } from './producer.js';
export type { ProducerStageReport, ProducerRunResult } from './producer.js';
