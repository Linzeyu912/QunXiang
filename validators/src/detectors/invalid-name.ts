import type { ValidationResult, ValidationIssue } from '../types.js';

/** Characters that should not appear in entity names */
const INVALID_NAME_CHARS = new Set([
  '的', '了', '着', '过', '得', '地', '在', '有', '不', '是',
  '把', '被', '让', '给', '对', '和', '与', '及', '或', '但',
  '而', '且', '从', '到', '往', '向', '比', '跟', '即', '使',
  '我', '你', '他', '她', '它', '这', '那', '自',
]);

export interface EntityLike {
  name: string;
  aliases?: string[];
}

export function detectInvalidName(entity: EntityLike): ValidationIssue | null {
  const name = entity.name.trim();

  if (name.length < 2) {
    return {
      field: 'name',
      message: `Name "${name}" is too short (min 2 chars)`,
      severity: 'error',
    };
  }

  if (name.length > 8) {
    return {
      field: 'name',
      message: `Name "${name}" is too long (max 8 chars)`,
      severity: 'error',
    };
  }

  // Check for invalid characters
  for (const ch of name) {
    if (INVALID_NAME_CHARS.has(ch)) {
      return {
        field: 'name',
        message: `Name "${name}" contains invalid character "${ch}"`,
        severity: 'warning',
      };
    }
  }

  // Check for digits in name (likely not a real entity name)
  if (/\d/.test(name)) {
    return {
      field: 'name',
      message: `Name "${name}" contains digits`,
      severity: 'warning',
    };
  }

  return null;
}

export function validateInvalidName(entity: EntityLike): ValidationResult {
  const issue = detectInvalidName(entity);
  return {
    valid: issue === null || issue.severity !== 'error',
    issues: issue ? [issue] : [],
  };
}
