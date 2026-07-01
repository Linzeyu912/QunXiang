import type { Character } from '@novel-agent/core';
import type { ValidationResult, ValidationIssue } from '../types.js';

export function detectMissingDescription(
  character: Omit<Character, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>
): ValidationIssue | null {
  if (!character.description || character.description.trim().length === 0) {
    return {
      field: 'description',
      message: 'Missing or empty description',
      severity: 'error',
    };
  }
  return null;
}

export function detectMissingChapters(
  character: Omit<Character, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>
): ValidationIssue | null {
  if (!character.chapterAppearances || character.chapterAppearances.length === 0) {
    return {
      field: 'chapterAppearances',
      message: 'No chapter appearances recorded',
      severity: 'error',
    };
  }
  return null;
}

export function validateMissingFields(
  character: Omit<Character, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>
): ValidationResult {
  const issues: ValidationIssue[] = [];

  const descIssue = detectMissingDescription(character);
  if (descIssue) issues.push(descIssue);

  const chapterIssue = detectMissingChapters(character);
  if (chapterIssue) issues.push(chapterIssue);

  return {
    valid: issues.length === 0,
    issues,
  };
}
