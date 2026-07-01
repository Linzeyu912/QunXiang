import type { ValidationResult, ValidationIssue } from '../types.js';

export interface DedupeableEntity {
  name: string;
  aliases?: string[];
  confidence: number;
  [key: string]: unknown;
}

/**
 * Deduplicate entities within a batch by name (case-insensitive).
 * Keeps the entity with the highest confidence when duplicates are found.
 * Also merges aliases from duplicates into the kept entity.
 */
export function deduplicateEntities<T extends DedupeableEntity>(entities: T[]): {
  unique: T[];
  duplicates: Array<{ entity: T; mergedInto: string; reason: string }>;
} {
  const nameMap = new Map<string, T>();
  const duplicates: Array<{ entity: T; mergedInto: string; reason: string }> = [];

  for (const entity of entities) {
    const nameKey = entity.name.toLowerCase().trim();

    if (nameMap.has(nameKey)) {
      const existing = nameMap.get(nameKey)!;
      // Keep the one with higher confidence
      if (entity.confidence > existing.confidence) {
        // Merge aliases from existing into the new one
        const mergedAliases = [...new Set([
          ...(entity.aliases || []),
          ...(existing.aliases || []),
          existing.name,
        ])].filter(a => a.toLowerCase() !== nameKey);

        nameMap.set(nameKey, {
          ...entity,
          aliases: mergedAliases,
        } as T);
        duplicates.push({
          entity: existing,
          mergedInto: entity.name,
          reason: `Duplicate of "${entity.name}" (lower confidence ${existing.confidence.toFixed(2)})`,
        });
      } else {
        // Merge aliases from new entity into existing
        const mergedAliases = [...new Set([
          ...(existing.aliases || []),
          ...(entity.aliases || []),
          entity.name,
        ])].filter(a => a.toLowerCase() !== nameKey);

        nameMap.set(nameKey, {
          ...existing,
          aliases: mergedAliases,
        } as T);
        duplicates.push({
          entity,
          mergedInto: existing.name,
          reason: `Duplicate of "${existing.name}" (lower confidence ${entity.confidence.toFixed(2)})`,
        });
      }
    } else {
      nameMap.set(nameKey, { ...entity });
    }
  }

  return {
    unique: Array.from(nameMap.values()),
    duplicates,
  };
}

/**
 * Validate a batch of entities for duplicates.
 * Returns validation result with issues for each duplicate found.
 */
export function validateEntityDedup<T extends DedupeableEntity>(
  entities: T[]
): ValidationResult & { unique: T[] } {
  const { unique, duplicates } = deduplicateEntities(entities);

  const issues: ValidationIssue[] = duplicates.map(d => ({
    field: 'name',
    message: d.reason,
    severity: 'warning' as const,
  }));

  return {
    valid: duplicates.length === 0,
    issues,
    unique,
  };
}
