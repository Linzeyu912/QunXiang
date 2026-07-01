import type { Chapter } from '../extractor.js';
import { extractPronouns, resolvePronounsToCharacters } from './pronoun-resolver.js';
import {
  extractDescriptors,
  extractHonorifics,
  matchDescriptorToCharacter,
} from './descriptor-resolver.js';
import {
  extractChineseNames,
  normalizeChineseName,
  isSameChineseName,
} from './chinese-names.js';
import { ALIAS_PATTERNS } from './patterns.js';

export interface CoreferenceResult {
  resolvedPronouns: Map<string, string>; // pronoun -> character name
  extractedAliases: Map<string, string>; // alias -> canonical name
  potentialCharacters: { name: string; confidence: number }[];
  chapterContent: Map<number, string>;
}

export interface AliasCandidate {
  alias: string;
  canonical: string;
  pattern: string;
  chapter: number;
}

/**
 * Main coreference resolution function
 * Links pronouns and descriptors to canonical character names
 */
export function resolveCoreference(
  chapters: Chapter[],
  knownCharacters: string[]
): CoreferenceResult {
  const result: CoreferenceResult = {
    resolvedPronouns: new Map(),
    extractedAliases: new Map(),
    potentialCharacters: [],
    chapterContent: new Map(),
  };

  // Build chapter content map
  for (const chapter of chapters) {
    result.chapterContent.set(chapter.index, chapter.content);
  }

  // Process each chapter
  for (const chapter of chapters) {
    const content = chapter.content;

    // 1. Extract pronouns and resolve to characters
    const pronouns = extractPronouns(content, chapter.index);
    const resolvedPronouns = resolvePronounsToCharacters(
      pronouns,
      knownCharacters,
      result.chapterContent
    );

    for (const resolved of resolvedPronouns) {
      if (resolved.confidence > 0.3) {
        result.resolvedPronouns.set(
          `${resolved.pronoun}@${chapter.index}`,
          resolved.resolvedTo
        );
      }
    }

    // 2. Extract descriptors and try to match to characters
    const descriptors = extractDescriptors(content, chapter.index);
    for (const desc of descriptors) {
      const match = matchDescriptorToCharacter(desc.descriptor, knownCharacters);
      if (match.character && match.confidence > 0.5) {
        // Descriptor resolved to a known character
      }
    }

    // 3. Extract honorific references (Mr. Zhang, 张先生, etc.)
    const honorifics = extractHonorifics(content, chapter.index);
    for (const hf of honorifics) {
      // If the name after honorific matches a known character, create alias
      if (knownCharacters.includes(hf.name)) {
        result.extractedAliases.set(
          `${hf.honorific}${hf.name}`,
          hf.name
        );
      }
    }

    // 4. Extract Chinese names
    const chineseNames = extractChineseNames(content);
    for (const cn of chineseNames) {
      if (cn.confidence > 0.7) {
        const normalized = normalizeChineseName(cn.name);
        // Check if this matches a known character
        const match = knownCharacters.find(k =>
          isSameChineseName(k, normalized)
        );
        if (match) {
          result.extractedAliases.set(cn.name, match);
        } else {
          // Potential new character
          result.potentialCharacters.push({
            name: cn.name,
            confidence: cn.confidence * 0.5, // Lower confidence for new
          });
        }
      }
    }

    // 5. Extract aliases using patterns
    const aliases = extractAliases(content, chapter.index);
    for (const alias of aliases) {
      result.extractedAliases.set(alias.alias, alias.canonical);
    }
  }

  return result;
}

/**
 * Extract aliases using pattern matching
 */
function extractAliases(
  text: string,
  chapterIndex: number
): AliasCandidate[] {
  const aliases: AliasCandidate[] = [];

  for (const pattern of ALIAS_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match;

    while ((match = regex.exec(text)) !== null) {
      if (match.length >= 3) {
        // Pattern captures: [full match, entity, alias]
        aliases.push({
          alias: match[2].trim(),
          canonical: match[1].trim(),
          pattern: pattern.source,
          chapter: chapterIndex,
        });
      } else if (match.length === 2) {
        aliases.push({
          alias: match[1].trim(),
          canonical: '', // Need context to determine
          pattern: pattern.source,
          chapter: chapterIndex,
        });
      }
    }
  }

  return aliases;
}

/**
 * Extend character aliases based on coreference resolution
 */
export function extendCharacterAliases(
  characters: Array<{ name: string; aliases: string[] }>,
  coreferenceResult: CoreferenceResult
): Array<{ name: string; aliases: string[] }> {
  const aliasMap = new Map<string, Set<string>>();

  // Initialize with existing aliases
  for (const char of characters) {
    aliasMap.set(char.name, new Set(char.aliases));
  }

  // Add extracted aliases
  for (const [alias, canonical] of coreferenceResult.extractedAliases) {
    if (aliasMap.has(canonical)) {
      aliasMap.get(canonical)!.add(alias);
    }
  }

  // Convert back to array
  return Array.from(aliasMap.entries()).map(([name, aliases]) => ({
    name,
    aliases: Array.from(aliases),
  }));
}

/**
 * Merge potential new characters with known characters
 */
export function mergePotentialCharacters(
  knownCharacters: string[],
  coreferenceResult: CoreferenceResult,
  minConfidence = 0.6
): string[] {
  const merged = new Set(knownCharacters);

  for (const potential of coreferenceResult.potentialCharacters) {
    if (potential.confidence >= minConfidence) {
      // Check if it's already known (by Chinese name normalization)
      const isKnown = knownCharacters.some(k =>
        isSameChineseName(k, potential.name)
      );

      if (!isKnown) {
        merged.add(potential.name);
      }
    }
  }

  return Array.from(merged);
}
