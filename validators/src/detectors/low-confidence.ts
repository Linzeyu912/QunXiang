import type { Character } from '@qunxiang/core';
import type { ValidationResult, ValidationIssue } from '../types.js';

const LOW_CONFIDENCE_THRESHOLD = 0.3;

/**
 * 置信度不足只记警告、不拒绝：置信度经过证据校准后，低分表示
 * 「证据弱的边缘实体」，应进入低置信度库供人工裁决，而不是直接丢弃。
 * 真正的幻觉实体（正文完全没出现）由提取阶段的提及数过滤负责。
 */
export function detectLowConfidence(
  character: Omit<Character, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>
): ValidationIssue | null {
  if (character.confidence < LOW_CONFIDENCE_THRESHOLD) {
    return {
      field: 'confidence',
      message: `Confidence ${character.confidence} is below threshold ${LOW_CONFIDENCE_THRESHOLD}`,
      severity: 'warning' as const,
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
