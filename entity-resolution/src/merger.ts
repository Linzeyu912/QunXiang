import type { Character } from './types.js';

type CharacterInput = Omit<Character, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>;

/**
 * Merge two characters into one.
 * - description: concatenate with '; '
 * - confidence: take max
 * - chapterAppearances: merge and deduplicate
 * - aliases: merge and deduplicate
 * - other fields: take from primary character
 */
export function mergeCharacters(primary: CharacterInput, secondary: CharacterInput) {
  return {
    name: primary.name,
    aliases: [...new Set([...primary.aliases, ...secondary.aliases])],
    description: [primary.description, secondary.description]
      .filter(Boolean)
      .join('; '),
    confidence: Math.max(primary.confidence, secondary.confidence),
    status: primary.status,
    chapterRef: primary.chapterRef ?? secondary.chapterRef,
    firstChapter: Math.min(
      primary.firstChapter ?? Infinity,
      secondary.firstChapter ?? Infinity
    ),
    lastChapter: Math.max(
      primary.lastChapter ?? 0,
      secondary.lastChapter ?? 0
    ),
    chapterAppearances: [
      ...new Set([...primary.chapterAppearances, ...secondary.chapterAppearances]),
    ].sort((a, b) => a - b),
    mentionCount: primary.mentionCount + secondary.mentionCount,
    dialogueCount: primary.dialogueCount + secondary.dialogueCount,
    coCharacters: [...new Set([...primary.coCharacters, ...secondary.coCharacters])],
  };
}
