import type { Character } from '@novel-agent/core';
import type { ValidationResult, ValidationIssue } from '../types.js';

const LOW_CONFIDENCE_THRESHOLD = 0.3;

export function detectLowConfidence(
  character: Omit<Character, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>
): ValidationIssue | null {
  if (character.confidence < LOW_CONFIDENCE_THRESHOLD) {
    return {
      field: 'confidence',
      message: `Confidence ${character.confidence} is below threshold ${LOW_CONFIDENCE_THRESHOLD}`,
      severity: 'error',
    };
  }
  return null;
}

export function validateLowConfidence(
  character: Omit<Character, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>
): ValidationResult {
  const issue = detectLowConfidence(character);
  return {
    valid: issue === null,
    issues: issue ? [issue] : [],
  };
}
