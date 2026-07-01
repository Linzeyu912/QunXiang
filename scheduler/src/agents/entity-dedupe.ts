/**
 * Generic entity deduplication for items and locations.
 *
 * Mirrors the character-resolution logic from entity-resolution/resolve(), but
 * generic over the entity shape so it can be reused for Item/Location without
 * importing Character-specific detectors. Uses:
 *   - same-name detection (case-insensitive)
 *   - Chinese address-form normalization (薰→熏)
 *   - alias mutual containment (either entity's aliases contains the other's name)
 */
import { isSameChineseName } from '@novel-agent/entity-resolution';

type EntityLike = {
  name: string;
  aliases?: string[];
  [key: string]: unknown;
};

function normalizeKey(value: string): string {
  return value.toLowerCase().trim();
}

function isAliasMatchGeneric(a: EntityLike, b: EntityLike): boolean {
  const aName = normalizeKey(a.name);
  const bName = normalizeKey(b.name);
  const aAliases = (a.aliases || []).map(normalizeKey);
  const bAliases = (b.aliases || []).map(normalizeKey);

  if (aAliases.includes(bName)) return true;
  if (bAliases.includes(aName)) return true;
  return false;
}

function mergeEntities<T extends EntityLike>(existing: T, incoming: T): T {
  const mergedAliases = [
    ...(existing.aliases || []),
    ...(incoming.aliases || []),
    incoming.name !== existing.name ? incoming.name : undefined,
  ].filter((value): value is string => Boolean(value));

  const dedupAliases = [...new Set(mergedAliases.map(normalizeKey))]
    .map((key) => {
      const original = [...(existing.aliases || []), ...(incoming.aliases || []), incoming.name]
        .find((name) => normalizeKey(name) === key);
      return original || key;
    })
    .filter((alias) => normalizeKey(alias) !== normalizeKey(existing.name));

  return {
    ...existing,
    ...incoming,
    aliases: dedupAliases,
  };
}

export function deduplicateEntities<T extends EntityLike>(entities: T[]): T[] {
  const nameMap = new Map<string, T>();
  let merged = 0;

  for (const entity of entities) {
    const nameKey = normalizeKey(entity.name);
    let mergeTargetKey: string | null = null;

    for (const [existingKey, existingEntity] of nameMap.entries()) {
      if (
        existingKey === nameKey ||
        isAliasMatchGeneric(existingEntity, entity) ||
        isSameChineseName(existingEntity.name, entity.name)
      ) {
        mergeTargetKey = existingKey;
        break;
      }
    }

    if (mergeTargetKey) {
      const existing = nameMap.get(mergeTargetKey)!;
      nameMap.set(mergeTargetKey, mergeEntities(existing, entity));
      merged++;
    } else {
      nameMap.set(nameKey, entity);
    }
  }

  if (merged > 0) {
    console.log(`[EntityDedupe] merged ${merged} duplicate entities`);
  }

  return Array.from(nameMap.values());
}