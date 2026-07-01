import type { Character, Location, Item } from '@novel-agent/core';

export interface ValidationIssue {
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

export type CharacterValidator = (character: Omit<Character, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>) => ValidationResult;

/** Generic entity type for locations/items validation */
export type EntityInput = Omit<Location, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>;
export type ItemInput = Omit<Item, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>;

export type EntityValidator = (entity: EntityInput) => ValidationResult;
