import type { Character } from '../types.js';

type CharacterInput = Omit<Character, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>;

/**
 * Same-name detection using case-insensitive comparison.
 * "张三" and "张三丰" are different, but "Zhang San" and "zhang san" should be merged.
 */
export function normalizeName(name: string): string {
  return name.toLowerCase().trim();
}

export function isSameName(name1: string, name2: string): boolean {
  const n1 = normalizeName(name1);
  const n2 = normalizeName(name2);

  // Exact match after normalization (case-insensitive)
  if (n1 === n2) {
    return true;
  }

  // Check if names are the same (handles "Zhang San" vs "zhang san")
  return n1 === n2;
}

export function sameNameDetector(char1: CharacterInput, char2: CharacterInput): boolean {
  return isSameName(char1.name, char2.name);
}
