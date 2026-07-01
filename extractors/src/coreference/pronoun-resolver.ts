import { CHINESE_PRONOUNS, ENGLISH_PRONOUNS } from './patterns.js';

export interface PronounCandidate {
  pronoun: string;
  gender: 'male' | 'female' | 'neutral';
  text: string;
  index: number;
  chapterIndex: number;
}

export interface ResolvedPronoun {
  pronoun: string;
  resolvedTo: string;
  confidence: number;
  gender: 'male' | 'female' | 'neutral';
}

/**
 * Extract all pronouns from text with their positions
 */
export function extractPronouns(
  text: string,
  chapterIndex: number
): PronounCandidate[] {
  const candidates: PronounCandidate[] = [];

  // Extract Chinese pronouns
  for (const [gender, pronouns] of Object.entries(CHINESE_PRONOUNS)) {
    for (const pronoun of pronouns) {
      let searchStart = 0;
      let index: number;
      while ((index = text.indexOf(pronoun, searchStart)) !== -1) {
        // Check if it's a word boundary match (not part of another word)
        const beforeOk = index === 0 || /[\s\n，。！？、；：""''【】（）]/.test(text[index - 1]);
        const afterOk = index + pronoun.length >= text.length ||
                       /[\s\n，。！？、；：""''【】（）]/.test(text[index + pronoun.length]);

        if (beforeOk && afterOk) {
          candidates.push({
            pronoun,
            gender: gender as 'male' | 'female' | 'neutral',
            text,
            index,
            chapterIndex,
          });
        }
        searchStart = index + 1;
      }
    }
  }

  // Extract English pronouns (case-insensitive)
  const lowerText = text.toLowerCase();
  for (const [gender, pronouns] of Object.entries(ENGLISH_PRONOUNS)) {
    for (const pronoun of pronouns) {
      const regex = new RegExp(`\\b${pronoun}\\b`, 'gi');
      let match;
      while ((match = regex.exec(text)) !== null) {
        candidates.push({
          pronoun: match[0],
          gender: gender as 'male' | 'female' | 'neutral',
          text,
          index: match.index,
          chapterIndex,
        });
      }
    }
  }

  return candidates;
}

/**
 * Resolve pronouns to character names based on context
 */
export function resolvePronounsToCharacters(
  pronouns: PronounCandidate[],
  characters: string[],
  chapterContent: Map<number, string>
): ResolvedPronoun[] {
  const resolved: ResolvedPronoun[] = [];
  const characterLowerMap = new Map(
    characters.map(c => [c.toLowerCase(), c])
  );

  for (const pronoun of pronouns) {
    // Find the most recent character of the same gender in recent text
    const recentText = getRecentText(pronoun, chapterContent);
    const candidate = findBestMatch(pronoun, recentText, characterLowerMap);

    resolved.push({
      pronoun: pronoun.pronoun,
      resolvedTo: candidate.name,
      confidence: candidate.confidence,
      gender: pronoun.gender,
    });
  }

  return resolved;
}

function getRecentText(pronoun: PronounCandidate, chapterContent: Map<number, string>): string {
  const parts: string[] = [];

  // Get text from same chapter before the pronoun
  const chapterText = chapterContent.get(pronoun.chapterIndex) || '';
  parts.push(chapterText.substring(0, pronoun.index));

  return parts.join('\n');
}

function findBestMatch(
  pronoun: PronounCandidate,
  recentText: string,
  characterMap: Map<string, string>
): { name: string; confidence: number } {
  const textLower = recentText.toLowerCase();
  let bestName = '';
  let bestConfidence = 0;

  for (const [lowerName, properName] of characterMap) {
    // Find last occurrence before pronoun
    const lastIndex = textLower.lastIndexOf(lowerName);

    if (lastIndex !== -1) {
      // Calculate confidence based on distance (closer = higher)
      const distance = pronoun.index - lastIndex;
      let confidence = 1.0;

      // Distance-based confidence decay
      if (distance > 500) confidence *= 0.5;
      else if (distance > 200) confidence *= 0.7;
      else if (distance > 100) confidence *= 0.85;
      else if (distance > 50) confidence *= 0.95;

      // Gender matching
      // For now, skip gender matching as it requires more context
      // In a full implementation, we'd track character genders

      if (confidence > bestConfidence) {
        bestConfidence = confidence;
        bestName = properName;
      }
    }
  }

  // If no character found, return unknown
  if (!bestName) {
    return { name: '【未知】', confidence: 0 };
  }

  return { name: bestName, confidence: bestConfidence };
}
