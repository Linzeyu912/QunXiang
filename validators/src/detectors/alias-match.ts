import type { Character } from '@novel-agent/core';
import type { ValidationResult, ValidationIssue } from '../types.js';

export function detectAliasMatch(
  character: Omit<Character, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>
): ValidationIssue | null {
  const nameLower = character.name.toLowerCase();
  const matchingAlias = character.aliases.find(alias => alias.toLowerCase() === nameLower);

  if (matchingAlias) {
    return {
      field: 'aliases',
      message: `Alias "${matchingAlias}" matches character name "${character.name}"`,
      severity: 'warning',
    };
  }
  return null;
}

export function validateAliasMatch(
  character: Omit<Character, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>
): ValidationResult {
  const issue = detectAliasMatch(character);
  return {
    valid: issue === null,
    issues: issue ? [issue] : [],
  };
}
