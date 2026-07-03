import type { Character } from './types.js';
import type { ResolutionResult } from './types.js';
import { isAliasMatch } from './detectors/alias-match.js';
import {
  chooseCanonicalCharacterName,
  isCollectiveCharacterAlias,
  sanitizeCharacterAliases,
} from './detectors/alias-safety.js';
import { isSameChineseName } from './detectors/same-chinese-name.js';
import { mergeCharacters } from './merger.js';

type CharacterInput = Omit<Character, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>;
type CharacterOutput = Omit<Character, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>;

/**
 * Core entity resolution logic.
 * Merges duplicate characters based on:
 * 1. Same-name detection (case-insensitive)
 * 2. Alias matching (if A's aliases contain B's name)
 */
export function resolve(characters: CharacterInput[]): ResolutionResult {
  const nameMap = new Map<string, CharacterInput>();
  let mergedCount = 0;

  for (const character of characters) {
    if (isCollectiveCharacterAlias(character.name)) continue;

    const nameKey = character.name.toLowerCase();

    // Find an already-seen character that refers to the same entity:
    //   - same name (case-insensitive),
    //   - alias mutual containment, or
    //   - Chinese address-form normalization (e.g. 萧炎哥 → 萧炎).
    // (Previously this set mergedInto to the *current* character's key, which
    //  was never in the map yet — so alias matches were silently ignored.
    //  Fixed: use the matched existing character's key.)
    let mergeTargetKey: string | null = null;
    for (const [existingKey, existingChar] of nameMap.entries()) {
      if (
        existingKey === nameKey ||
        isAliasMatch(existingChar as CharacterInput, character) ||
        isSameChineseName(existingChar.name, character.name)
      ) {
        mergeTargetKey = existingKey;
        break;
      }
    }

    if (mergeTargetKey) {
      const existing = nameMap.get(mergeTargetKey)!;
      const merged = mergeCharacters(existing as CharacterInput, character);
      nameMap.set(mergeTargetKey, {
        ...existing,
        ...merged,
      } as CharacterInput);
      mergedCount++;
    } else {
      nameMap.set(nameKey, { ...character });
    }
  }

  const knownCharacterNames = Array.from(nameMap.values()).map((char) => char.name);
  const knownAliasesByCharacter = Object.fromEntries(
    Array.from(nameMap.values()).map((char) => [char.name, char.aliases ?? []])
  );

  // Deduplicate and clean aliases within each character.
  const resolvedCharacters: CharacterOutput[] = Array.from(nameMap.values()).map(
    (char) => {
      const canonicalName = chooseCanonicalCharacterName(char.name, char.aliases);
      const aliasPool = canonicalName === char.name
        ? char.aliases
        : [...char.aliases, char.name];

      return {
        name: canonicalName,
        aliases: sanitizeCharacterAliases(canonicalName, aliasPool, {
          knownCharacterNames,
          knownAliasesByCharacter,
        }),
        description: char.description,
        confidence: char.confidence,
        status: char.status,
        chapterRef: char.chapterRef,
        firstChapter: char.firstChapter,
        lastChapter: char.lastChapter,
        chapterAppearances: char.chapterAppearances,
        mentionCount: char.mentionCount,
        dialogueCount: char.dialogueCount,
        coCharacters: char.coCharacters,
        outfits: char.outfits,
        tier: (char as any).tier,
        importanceScore: (char as any).importanceScore,
        storyScore: (char as any).storyScore,
        productionScore: (char as any).productionScore,
        pillarCausal: (char as any).pillarCausal,
        pillarUniqueness: (char as any).pillarUniqueness,
        pillarTransition: (char as any).pillarTransition,
      };
    }
  );

  return {
    characters: resolvedCharacters,
    merged: mergedCount,
  };
}
