import type { Chapter } from '@novel-agent/extractors/extractor';
import { RELATIONSHIP_INDICATORS } from './patterns.js';
import type { Relationship, RelationshipType } from '@novel-agent/schemas';

export interface RelationshipExtractorOptions {
  minConfidence: number;
  maxDistance: number; // Max sentence distance for relationship inference
}

const DEFAULT_OPTIONS: RelationshipExtractorOptions = {
  minConfidence: 0.5,
  maxDistance: 3, // sentences
};

/**
 * Extract relationships between characters from chapter text
 */
export function extractRelationships(
  chapters: Chapter[],
  characters: string[]
): Relationship[] {
  const relationships: Relationship[] = [];
  const characterLowerMap = new Map(
    characters.map(c => [c.toLowerCase(), c])
  );

  for (const chapter of chapters) {
    const sentences = splitSentences(chapter.content);

    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i];

      // Find all characters mentioned in this sentence
      const charsInSentence = findCharactersInText(sentence, characterLowerMap);

      if (charsInSentence.length < 2) continue;

      // Check for relationship indicators
      for (const char1 of charsInSentence) {
        for (const char2 of charsInSentence) {
          if (char1 === char2) continue;

          // Check each relationship type
          for (const relType of ['family', 'romantic', 'friendship', 'antagonistic'] as const) {
            const evidence = findRelationshipEvidence(
              sentence,
              char1,
              char2,
              relType
            );

            if (evidence) {
              const existing = relationships.find(
                r => r.subject === char1 && r.object === char2 && r.type === relType
              );

              if (existing) {
                existing.evidence.push({
                  text: sentence,
                  chapter: chapter.index,
                  sentence: sentence.substring(0, 50),
                });
                existing.confidence = Math.min(0.99, existing.confidence + 0.1);
                existing.chapterLast = chapter.index;
              } else {
                relationships.push({
                  subject: char1,
                  object: char2,
                  type: relType,
                  confidence: evidence.confidence,
                  evidence: [{
                    text: sentence,
                    chapter: chapter.index,
                    sentence: sentence.substring(0, 50),
                  }],
                  chapterFirst: chapter.index,
                  chapterLast: chapter.index,
                });
              }
            }
          }
        }
      }
    }
  }

  return relationships;
}

/**
 * Find characters in text
 */
function findCharactersInText(
  text: string,
  characterMap: Map<string, string>
): string[] {
  const found: string[] = [];
  const textLower = text.toLowerCase();

  for (const [lowerName, properName] of characterMap) {
    if (textLower.includes(lowerName)) {
      found.push(properName);
    }
  }

  return found;
}

/**
 * Find relationship evidence in a sentence
 */
function findRelationshipEvidence(
  sentence: string,
  char1: string,
  char2: string,
  relType: 'family' | 'romantic' | 'friendship' | 'antagonistic'
): { confidence: number; indicator: string } | null {
  const sentenceLower = sentence.toLowerCase();
  const char1Lower = char1.toLowerCase();
  const char2Lower = char2.toLowerCase();

  // Check explicit relationship words
  const explicitWords = RELATIONSHIP_INDICATORS[relType].chinese?.explicit ||
                       RELATIONSHIP_INDICATORS[relType].english?.explicit || [];
  const dialogueWords = RELATIONSHIP_INDICATORS[relType].chinese?.dialogue ||
                       RELATIONSHIP_INDICATORS[relType].english?.dialogue || [];
  const actionWords = RELATIONSHIP_INDICATORS[relType].chinese?.action ||
                     RELATIONSHIP_INDICATORS[relType].english?.action || [];

  // Check for explicit indicators
  for (const word of explicitWords) {
    if (sentenceLower.includes(word)) {
      // High confidence for explicit relationship words
      return { confidence: 0.85, indicator: word };
    }
  }

  // Check for dialogue indicators
  for (const word of dialogueWords) {
    if (sentenceLower.includes(word)) {
      // Medium confidence for dialogue-based indicators
      return { confidence: 0.65, indicator: word };
    }
  }

  // Check for action indicators
  for (const word of actionWords) {
    if (sentenceLower.includes(word)) {
      // Medium confidence for action-based indicators
      return { confidence: 0.6, indicator: word };
    }
  }

  // Check if both characters appear in same sentence (weak evidence)
  if (sentenceLower.includes(char1Lower) && sentenceLower.includes(char2Lower)) {
    return { confidence: 0.3, indicator: 'co_mention' };
  }

  return null;
}

/**
 * Split text into sentences
 */
function splitSentences(text: string): string[] {
  // Chinese sentence delimiters
  const chineseDelimiters = /[。！？；\n]/;
  // English sentence delimiters
  const englishDelimiters = /[.!?;\n]/;

  // Combined pattern
  const pattern = /[。！？；.!?;\n]+/;
  return text.split(pattern).filter(s => s.trim().length > 0);
}

/**
 * Assign relationships to characters
 */
export function assignRelationshipsToCharacters(
  characters: string[],
  relationships: Relationship[]
): Map<string, Relationship[]> {
  const charRelationships = new Map<string, Relationship[]>();

  // Initialize
  for (const char of characters) {
    charRelationships.set(char, []);
  }

  // Assign relationships to both parties
  for (const rel of relationships) {
    const subjectRels = charRelationships.get(rel.subject);
    if (subjectRels) {
      subjectRels.push(rel);
    }

    // Also add to object (bidirectional)
    const objectRels = charRelationships.get(rel.object);
    if (objectRels) {
      objectRels.push({
        ...rel,
        subject: rel.object,
        object: rel.subject,
        type: rel.type,
      });
    }
  }

  return charRelationships;
}

/**
 * Filter relationships by confidence
 */
export function filterRelationshipsByConfidence(
  relationships: Relationship[],
  minConfidence: number
): Relationship[] {
  return relationships.filter(r => r.confidence >= minConfidence);
}

/**
 * Merge duplicate relationships
 */
export function mergeDuplicateRelationships(
  relationships: Relationship[]
): Relationship[] {
  const merged = new Map<string, Relationship>();

  for (const rel of relationships) {
    const key = `${rel.subject}__${rel.object}__${rel.type}`;

    if (merged.has(key)) {
      const existing = merged.get(key)!;
      // Keep highest confidence
      if (rel.confidence > existing.confidence) {
        merged.set(key, rel);
      }
      // Merge evidence
      existing.evidence.push(...rel.evidence);
      // Update chapter range
      if (rel.chapterFirst && (!existing.chapterFirst || rel.chapterFirst < existing.chapterFirst)) {
        existing.chapterFirst = rel.chapterFirst;
      }
      if (rel.chapterLast && (!existing.chapterLast || rel.chapterLast > existing.chapterLast)) {
        existing.chapterLast = rel.chapterLast;
      }
    } else {
      merged.set(key, { ...rel });
    }
  }

  return Array.from(merged.values());
}
