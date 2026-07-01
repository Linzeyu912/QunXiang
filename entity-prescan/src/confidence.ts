/**
 * Confidence filtering for entity prescan results.
 * Filters out low-confidence entities before importance analysis.
 */
import type { EntityMention, EntityType } from './types.js';

export interface ConfidenceOptions {
  /** Minimum confidence threshold (default: 0.6) */
  minConfidence?: number;
  /** Minimum mention count to keep (default: 1) */
  minMentions?: number;
}

/**
 * Filter entities by confidence score.
 * Removes entities below the threshold and deduplicates.
 * Preserves total mention count and all chapter indices.
 */
export function filterByConfidence(
  entities: Map<EntityType, EntityMention[]>,
  options: ConfidenceOptions = {}
): Map<EntityType, EntityMention[]> {
  const { minConfidence = 0.6, minMentions = 1 } = options;

  const result = new Map<EntityType, EntityMention[]>();

  for (const [type, mentions] of entities) {
    // Group by text to count mentions
    const grouped = new Map<string, EntityMention[]>();
    for (const m of mentions) {
      const key = m.text;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(m);
    }

    // Filter by confidence and mention count
    const filtered: EntityMention[] = [];
    for (const [text, group] of grouped) {
      const maxConfidence = Math.max(...group.map(m => m.confidence));
      const explicitCounts = group
        .map((m) => m.totalCount)
        .filter((count): count is number => typeof count === 'number');
      const totalCount = explicitCounts.length > 0
        ? Math.max(group.length, ...explicitCounts)
        : group.length;

      if (maxConfidence >= minConfidence && totalCount >= minMentions) {
        // Keep the highest confidence mention, but preserve count info
        const best = group.reduce((a, b) => a.confidence > b.confidence ? a : b);
        const allChapters = [...new Set(group.flatMap(m => m.allChapters || [m.chapterIndex]))].sort((a, b) => a - b);
        const aliases = [...new Set(group.flatMap((m) => m.aliases || []))].filter(Boolean);

        filtered.push({
          ...best,
          totalCount,
          allChapters,
          aliases: aliases.length > 0 ? aliases : best.aliases,
        });
      }
    }

    result.set(type, filtered);
  }

  return result;
}
