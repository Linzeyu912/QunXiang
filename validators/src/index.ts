import type { Character, Location, Item } from '@novel-agent/core';
import type { ValidationResult, CharacterValidator, EntityInput } from './types.js';
import { validateLowConfidence } from './detectors/low-confidence.js';
import { validateMissingFields } from './detectors/missing-fields.js';
import { validateAliasMatch } from './detectors/alias-match.js';
import { validateInvalidName } from './detectors/invalid-name.js';
import { deduplicateEntities } from './detectors/entity-dedup.js';

export type { ValidationIssue, ValidationResult, CharacterValidator, EntityInput } from './types.js';
export { calculateConfidence, adjustConfidence } from './confidence.js';
export * from './detectors/index.js';

/**
 * Validate a character using all available validators.
 */
export function validateCharacter(
  character: Omit<Character, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>
): ValidationResult {
  const validators: CharacterValidator[] = [
    validateLowConfidence,
    validateMissingFields,
    validateAliasMatch,
  ];

  const allIssues = [];

  for (const validator of validators) {
    const result = validator(character);
    allIssues.push(...result.issues);
  }

  return {
    valid: allIssues.filter(i => i.severity === 'error').length === 0,
    issues: allIssues,
  };
}

/**
 * Validate multiple characters.
 */
export function validateCharacters(
  characters: Omit<Character, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>[]
): { valid: Omit<Character, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>[]; rejected: Array<{ character: Omit<Character, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>; reason: string }> } {
  const valid: Omit<Character, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>[] = [];
  const rejected: Array<{ character: Omit<Character, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>; reason: string }> = [];

  for (const character of characters) {
    const result = validateCharacter(character);
    if (result.valid) {
      valid.push(character);
    } else {
      rejected.push({
        character,
        reason: result.issues.map(i => i.message).join('; '),
      });
    }
  }

  return { valid, rejected };
}

/**
 * Validate a single location/item entity.
 * Checks: name validity, low confidence, alias conflicts.
 */
export function validateEntity(entity: EntityInput): ValidationResult {
  const allIssues = [];

  const nameResult = validateInvalidName(entity);
  allIssues.push(...nameResult.issues);

  // Adapt low-confidence check for entity (threshold 0.4 for prescan results)
  if (entity.confidence < 0.4) {
    allIssues.push({
      field: 'confidence',
      message: `Confidence ${entity.confidence} is below threshold 0.4`,
      severity: 'error' as const,
    });
  }

  return {
    valid: allIssues.filter(i => i.severity === 'error').length === 0,
    issues: allIssues,
  };
}

/**
 * Validate a batch of location/item entities.
 * Steps: individual validation → deduplication → filter invalid.
 */
export function validateEntityBatch<T extends EntityInput>(
  entities: T[]
): {
  valid: T[];
  rejected: Array<{ entity: T; reason: string }>;
  deduplicationMerged: number;
} {
  // Step 1: Deduplicate
  const { unique, duplicates } = deduplicateEntities(entities);

  // Step 2: Validate each unique entity
  const valid: T[] = [];
  const rejected: Array<{ entity: T; reason: string }> = [];

  for (const entity of unique) {
    const result = validateEntity(entity);
    if (result.valid) {
      valid.push({ ...entity, status: 'PENDING' as const } as T);
    } else {
      rejected.push({
        entity,
        reason: result.issues.map(i => i.message).join('; '),
      });
    }
  }

  return {
    valid,
    rejected,
    deduplicationMerged: duplicates.length,
  };
}
