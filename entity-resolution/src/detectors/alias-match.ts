import type { Character } from '../types.js';
import { isSafeAliasMatch } from './alias-safety.js';

type CharacterInput = Omit<Character, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>;

/**
 * Alias matching detection.
 * If A's aliases contain B's name (case-insensitive), merge A and B.
 */
export function isAliasMatch(char1: CharacterInput, char2: CharacterInput): boolean {
  return isSafeAliasMatch(char1, char2);
}

export function aliasMatchDetector(char1: CharacterInput, char2: CharacterInput): boolean {
  return isAliasMatch(char1, char2);
}
