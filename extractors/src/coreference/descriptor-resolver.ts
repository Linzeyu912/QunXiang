import { DESCRIPTOR_PATTERNS, CHINESE_HONORIFICS, ENGLISH_HONORIFICS } from './patterns.js';

export interface DescriptorMatch {
  fullMatch: string;
  descriptor: string;
  index: number;
  chapterIndex: number;
}

/**
 * Extract descriptor-based references (e.g., "the old man", "老者")
 */
export function extractDescriptors(
  text: string,
  chapterIndex: number
): DescriptorMatch[] {
  const matches: DescriptorMatch[] = [];

  for (const pattern of DESCRIPTOR_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match;

    while ((match = regex.exec(text)) !== null) {
      matches.push({
        fullMatch: match[0],
        descriptor: match[1] || match[0],
        index: match.index,
        chapterIndex,
      });
    }
  }

  return matches;
}

/**
 * Extract honorific references (Mr., 女士, etc.)
 */
export function extractHonorifics(
  text: string,
  chapterIndex: number
): { honorific: string; name: string; index: number; chapterIndex: number }[] {
  const results: { honorific: string; name: string; index: number; chapterIndex: number }[] = [];

  // Chinese honorific + name pattern
  for (const honorific of CHINESE_HONORIFICS) {
    const regex = new RegExp(`${honorific}\\s*([^\s，。！？、；：""''【】（）]{1,4})`, 'gi');
    let match;

    while ((match = regex.exec(text)) !== null) {
      results.push({
        honorific,
        name: match[1],
        index: match.index,
        chapterIndex,
      });
    }
  }

  // English honorific + name pattern
  for (const honorific of ENGLISH_HONORIFICS) {
    const regex = new RegExp(`\\b${honorific}\\.?\\s+([A-Z][a-z]+(?:\\s+[A-Z][a-z]+)?)`, 'gi');
    let match;

    while ((match = regex.exec(text)) !== null) {
      results.push({
        honorific,
        name: match[1],
        index: match.index,
        chapterIndex,
      });
    }
  }

  return results;
}

/**
 * Check if a descriptor likely refers to a known character
 */
export function matchDescriptorToCharacter(
  descriptor: string,
  characters: string[]
): { character: string | null; confidence: number } {
  const descriptorLower = descriptor.toLowerCase();

  for (const char of characters) {
    const charLower = char.toLowerCase();

    // Direct match
    if (descriptorLower.includes(charLower) || charLower.includes(descriptorLower)) {
      return { character: char, confidence: 0.9 };
    }

    // Partial match - descriptor contains part of name
    const nameParts = charLower.split(/\s+/);
    for (const part of nameParts) {
      if (part.length > 1 && descriptorLower.includes(part)) {
        return { character: char, confidence: 0.6 };
      }
    }
  }

  return { character: null, confidence: 0 };
}
