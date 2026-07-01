import type { Character } from '@novel-agent/core';
import { mergeEntityDescriptions } from '@novel-agent/core';
import type { EntityMention } from '@novel-agent/entity-prescan';
import { isSameChineseName } from '@novel-agent/entity-resolution';

type CharacterCandidate = Omit<Character, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>;

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function unionNumbers(...lists: Array<number[] | undefined>): number[] {
  return [...new Set(lists.flatMap((list) => list || []))].sort((a, b) => a - b);
}

function mentionChapters(mention: EntityMention): number[] {
  return mention.allChapters && mention.allChapters.length > 0
    ? mention.allChapters
    : [mention.chapterIndex];
}

function mentionCount(mention: EntityMention): number {
  return mention.totalCount || 1;
}

/**
 * Merge prescan mention signals (mention count, chapter coverage, confidence,
 * aliases) into an existing LLM character. The LLM character's name is
 * authoritative and is never overwritten by prescan text — prescan names that
 * differ from the LLM name are recorded as aliases instead.
 */
function mergePrescanIntoCharacter(
  character: CharacterCandidate,
  prescanMentions: EntityMention[]
): CharacterCandidate {
  if (prescanMentions.length === 0) return character;

  const chapters = unionNumbers(
    character.chapterAppearances,
    ...prescanMentions.map((mention) => mentionChapters(mention))
  );
  const prescanCount = Math.max(...prescanMentions.map(mentionCount));
  const prescanConfidence = Math.max(...prescanMentions.map((mention) => mention.confidence));
  // Prescan mention text is also a name for this character → record as alias.
  const prescanAliases = prescanMentions.flatMap((mention) => [
    ...(mention.aliases || []),
    mention.text,
  ]);

  return {
    ...character,
    aliases: unique([...(character.aliases || []), ...prescanAliases]).filter(
      (alias) => alias !== character.name
    ),
    confidence: Math.max(character.confidence || 0, prescanConfidence),
    chapterRef: character.chapterRef || (chapters[0] != null ? String(chapters[0]) : undefined),
    firstChapter: chapters.length > 0 ? chapters[0] : character.firstChapter,
    lastChapter: chapters.length > 0 ? chapters[chapters.length - 1] : character.lastChapter,
    chapterAppearances: chapters,
    mentionCount: Math.max(character.mentionCount || 0, prescanCount),
    dialogueCount: character.dialogueCount || 0,
    coCharacters: unique(character.coCharacters || []),
  };
}

function mergeCharacters(existing: CharacterCandidate, incoming: CharacterCandidate): CharacterCandidate {
  const chapters = unionNumbers(existing.chapterAppearances, incoming.chapterAppearances);

  return {
    ...existing,
    aliases: unique([
      ...(existing.aliases || []),
      ...(incoming.aliases || []),
      incoming.name !== existing.name ? incoming.name : undefined,
    ]).filter((alias) => alias !== existing.name),
    description: mergeEntityDescriptions(existing.description, incoming.description),
    confidence: Math.max(existing.confidence || 0, incoming.confidence || 0),
    chapterRef: existing.chapterRef || incoming.chapterRef,
    firstChapter: chapters.length > 0 ? chapters[0] : existing.firstChapter ?? incoming.firstChapter,
    lastChapter: chapters.length > 0 ? chapters[chapters.length - 1] : existing.lastChapter ?? incoming.lastChapter,
    chapterAppearances: chapters,
    mentionCount: Math.max(existing.mentionCount || 0, incoming.mentionCount || 0),
    dialogueCount: Math.max(existing.dialogueCount || 0, incoming.dialogueCount || 0),
    coCharacters: unique([...(existing.coCharacters || []), ...(incoming.coCharacters || [])]),
  };
}

/**
 * Fuse LLM-extracted characters with prescan character mentions.
 *
 * LLM-primary: the LLM decides the character set. prescan only ENRICHES
 * LLM-found characters (mention count, chapter coverage, confidence, aliases).
 * prescan-only mentions are NOT added as new characters — this removes false
 * positives like 萧炎哥/云岚宗/萧家 that prescan regex produced.
 *
 * An LLM character absorbs a prescan mention when the LLM character's name or
 * any of its aliases equals the prescan mention's text or one of its aliases
 * (case-insensitive).
 */
export function fuseCharactersWithPrescan(
  llmCharacters: CharacterCandidate[],
  prescanMentions: EntityMention[] = []
): CharacterCandidate[] {
  if (prescanMentions.length === 0) return llmCharacters;

  // Index each prescan mention by all its names (text + aliases) for lookup.
  const prescanByNames = new Map<string, EntityMention[]>();
  for (const mention of prescanMentions) {
    const names = unique([mention.text, ...(mention.aliases || [])]);
    for (const name of names) {
      const key = name.toLowerCase();
      const arr = prescanByNames.get(key) || [];
      arr.push(mention);
      prescanByNames.set(key, arr);
    }
  }

  const fused = new Map<string, CharacterCandidate>();

  for (const character of llmCharacters) {
    // Collect prescan mentions matching this LLM character's name or aliases.
    const matchNames = unique([character.name, ...(character.aliases || [])]);
    const matched = new Map<string, EntityMention>();
    for (const name of matchNames) {
      const arr = prescanByNames.get(name.toLowerCase());
      if (arr) for (const m of arr) matched.set(m.text, m);
    }
    // Address-form normalization: a prescan mention like "萧炎哥" that the LLM
    // didn't list as an alias still refers to the same character (萧炎) — merge
    // it in (becomes an alias + contributes mention count/chapters). This is the
    // "称呼肯定要合并" guarantee, with the LLM still authoritative for the set.
    for (const m of prescanMentions) {
      if (matched.has(m.text)) continue;
      if (
        isSameChineseName(m.text, character.name) ||
        (character.aliases || []).some((a) => isSameChineseName(m.text, a))
      ) {
        matched.set(m.text, m);
      }
    }

    const enriched = mergePrescanIntoCharacter(character, [...matched.values()]);
    const mapKey = character.name.toLowerCase();
    const existing = fused.get(mapKey);
    fused.set(mapKey, existing ? mergeCharacters(existing, enriched) : enriched);
  }

  // Intentionally NOT adding prescan-only characters: LLM is authoritative for
  // the character set. Old behavior (createCharacterFromPrescan) produced false
  // positives; it is removed per the LLM-primary direction.
  return [...fused.values()];
}
