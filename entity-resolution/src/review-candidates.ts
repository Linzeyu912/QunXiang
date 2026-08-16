import type { Character } from './types.js';
import { isSafeAliasMatch } from './detectors/alias-safety.js';
import { isSameChineseName } from './detectors/same-chinese-name.js';

export type CharacterMergeReason = '称谓归一化' | '已提取别名匹配';

export interface CharacterReviewSummary {
  id: string;
  name: string;
  aliases: string[];
  description?: string;
  confidence: number;
  firstChapter?: number;
  lastChapter?: number;
  chapterAppearances: number[];
}

export interface CharacterMergeCandidate {
  primaryId: string;
  secondaryId: string;
  reasons: CharacterMergeReason[];
  primary: CharacterReviewSummary;
  secondary: CharacterReviewSummary;
}

/** Compose the fields for a reviewer-approved merge without mutating either source record. */
export function mergeCharacterRecords<T extends Pick<Character, 'name' | 'aliases' | 'description' | 'confidence' | 'chapterRef' | 'firstChapter' | 'lastChapter' | 'chapterAppearances' | 'mentionCount' | 'dialogueCount' | 'coCharacters' | 'outfits'>>(
  primary: T,
  secondary: T,
): T {
  const chapters = [...new Set([...primary.chapterAppearances, ...secondary.chapterAppearances])].sort((a, b) => a - b);
  const firstChapters = [primary.firstChapter, secondary.firstChapter].filter(
    (chapter): chapter is number => chapter != null
  );
  const lastChapters = [primary.lastChapter, secondary.lastChapter].filter(
    (chapter): chapter is number => chapter != null
  );
  const aliases = [...new Set([...primary.aliases, ...secondary.aliases, secondary.name])]
    .filter((alias) => normalizeName(alias) !== normalizeName(primary.name));
  return {
    ...primary,
    aliases,
    description: [primary.description, secondary.description].filter(Boolean).join('; ') || undefined,
    confidence: Math.max(primary.confidence, secondary.confidence),
    chapterRef: primary.chapterRef ?? secondary.chapterRef,
    firstChapter: [...firstChapters, ...chapters].length > 0
      ? Math.min(...firstChapters, ...chapters)
      : undefined,
    lastChapter: [...lastChapters, ...chapters].length > 0
      ? Math.max(...lastChapters, ...chapters)
      : undefined,
    chapterAppearances: chapters,
    mentionCount: primary.mentionCount + secondary.mentionCount,
    dialogueCount: primary.dialogueCount + secondary.dialogueCount,
    coCharacters: [...new Set([...primary.coCharacters, ...secondary.coCharacters])],
    outfits: [...primary.outfits, ...secondary.outfits],
  };
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

function summarize(character: Character): CharacterReviewSummary {
  return {
    id: character.id,
    name: character.name,
    aliases: character.aliases,
    description: character.description,
    confidence: character.confidence,
    firstChapter: character.firstChapter,
    lastChapter: character.lastChapter,
    chapterAppearances: character.chapterAppearances,
  };
}

function comparePrimary(a: Character, b: Character): [Character, Character] {
  if (a.confidence !== b.confidence) return a.confidence > b.confidence ? [a, b] : [b, a];
  if (a.mentionCount !== b.mentionCount) return a.mentionCount > b.mentionCount ? [a, b] : [b, a];
  return a.id.localeCompare(b.id) <= 0 ? [a, b] : [b, a];
}

/**
 * Find pairs that look related but must not be merged automatically. Exact
 * canonical-name duplicates are intentionally omitted because `resolve()`
 * handles those losslessly before persistence.
 */
export function buildCharacterMergeCandidates(characters: Character[]): CharacterMergeCandidate[] {
  const candidates: CharacterMergeCandidate[] = [];

  for (let leftIndex = 0; leftIndex < characters.length; leftIndex += 1) {
    const left = characters[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < characters.length; rightIndex += 1) {
      const right = characters[rightIndex];
      if (normalizeName(left.name) === normalizeName(right.name)) continue;

      const reasons: CharacterMergeReason[] = [];
      if (isSameChineseName(left.name, right.name)) reasons.push('称谓归一化');
      if (isSafeAliasMatch(left, right)) reasons.push('已提取别名匹配');
      if (reasons.length === 0) continue;

      const [primary, secondary] = comparePrimary(left, right);
      candidates.push({
        primaryId: primary.id,
        secondaryId: secondary.id,
        reasons,
        primary: summarize(primary),
        secondary: summarize(secondary),
      });
    }
  }

  return candidates;
}
