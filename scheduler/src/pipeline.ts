import type { AgentType } from '@novel-agent/core';

export const EXTRACTION_PIPELINE: AgentType[] = [
  'extractor',
  'validator',
  'entity-resolution',
  'description-fusion',
  'visual-description',
  'prompt-generation',
  'reviewer',
];

export function getNextAgent(current: AgentType): AgentType | null {
  const index = EXTRACTION_PIPELINE.indexOf(current);
  if (index === -1 || index === EXTRACTION_PIPELINE.length - 1) {
    return null;
  }
  return EXTRACTION_PIPELINE[index + 1];
}
