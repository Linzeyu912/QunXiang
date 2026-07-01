import { scanFrequentCharacterEntities, type FrequentCharacterScanOptions } from './scanners/character.js';
import type { AliasIndexEntry, EntityMention, ScanChapter } from './types.js';

export interface CharacterAliasSignal {
  name: string;
  count: number;
}

export interface RoleDiscoveryResult {
  mentions: EntityMention[];
  aliasToPrimary: Map<string, string>;
  aliasesByPrimary: Map<string, CharacterAliasSignal[]>;
}

const MANUAL_ALIAS_MAPPINGS: Array<[primary: string, alias: string]> = [
  ['许七安', '许宁宴'],
  ['许平志', '许二叔'],
  ['许新年', '许二郎'],
  ['陈汉光', '陈府尹'],
  ['魏渊', '魏公'],
];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function countExactMentions(chapters: ScanChapter[], name: string): {
  count: number;
  firstChapter: number;
  firstPosition: number;
  chapters: number[];
} | undefined {
  const re = new RegExp(escapeRegex(name), 'g');
  let count = 0;
  let firstChapter = -1;
  let firstPosition = -1;
  const chapterSet = new Set<number>();

  for (const chapter of chapters) {
    re.lastIndex = 0;
    for (const match of chapter.content.matchAll(re)) {
      count++;
      chapterSet.add(chapter.index);
      if (firstChapter < 0) {
        firstChapter = chapter.index;
        firstPosition = match.index ?? 0;
      }
    }
  }

  if (count === 0) return undefined;
  return {
    count,
    firstChapter,
    firstPosition,
    chapters: [...chapterSet].sort((a, b) => a - b),
  };
}

function buildAliasIndex(existing: AliasIndexEntry[], newEntries: AliasIndexEntry[]): AliasIndexEntry[] {
  const map = new Map<string, AliasIndexEntry>();
  for (const e of existing) map.set(e.alias, e);
  for (const e of newEntries) {
    const prev = map.get(e.alias);
    if (prev) {
      map.set(e.alias, {
        alias: e.alias,
        chapterIndices: [...new Set([...prev.chapterIndices, ...e.chapterIndices])].sort((a, b) => a - b),
        count: prev.count + e.count,
      });
    } else {
      map.set(e.alias, e);
    }
  }
  return [...map.values()];
}

function mergeMention(primary: EntityMention, alias: EntityMention): EntityMention {
  const primaryChapters = primary.allChapters || [primary.chapterIndex];
  const aliasChapters = alias.allChapters || [alias.chapterIndex];
  const allChapters = [...new Set([...primaryChapters, ...aliasChapters])].sort((a, b) => a - b);
  const aliases = [...new Set([...(primary.aliases || []), ...(alias.aliases || []), alias.text])];
  const aliasIndex: AliasIndexEntry[] = buildAliasIndex(
    primary.aliasIndex || [],
    [{ alias: alias.text, chapterIndices: aliasChapters, count: alias.totalCount || 1 }]
  );

  return {
    ...primary,
    confidence: Math.max(primary.confidence, alias.confidence),
    totalCount: (primary.totalCount || 1) + (alias.totalCount || 1),
    allChapters,
    aliases,
    aliasIndex,
  };
}

function mentionFromExactScan(chapters: ScanChapter[], name: string): EntityMention | undefined {
  const exact = countExactMentions(chapters, name);
  if (!exact) return undefined;

  return {
    text: name,
    chapterIndex: exact.firstChapter,
    position: exact.firstPosition,
    source: 'regex',
    confidence: Math.min(0.95, 0.7 + Math.min(0.25, exact.count / 80)),
    totalCount: exact.count,
    allChapters: exact.chapters,
    aliasIndex: [{ alias: name, chapterIndices: exact.chapters, count: exact.count }],
  };
}

/**
 * Discover book-wide role candidates and roll verified aliases into canonical
 * character mentions before importance scoring.
 */
export function discoverFullTextCharacterMentions(
  chapters: ScanChapter[],
  options: FrequentCharacterScanOptions = {}
): RoleDiscoveryResult {
  const mentionsByText = new Map(
    scanFrequentCharacterEntities(chapters, options).map((mention) => [mention.text, mention])
  );
  const aliasToPrimary = new Map<string, string>();
  const aliasesByPrimary = new Map<string, CharacterAliasSignal[]>();

  for (const [primary, alias] of MANUAL_ALIAS_MAPPINGS) {
    const aliasMention = mentionsByText.get(alias) || mentionFromExactScan(chapters, alias);
    if (!aliasMention) continue;

    const primaryMention = mentionsByText.get(primary) || mentionFromExactScan(chapters, primary);
    if (!primaryMention) continue;

    mentionsByText.set(primary, mergeMention(primaryMention, aliasMention));
    mentionsByText.delete(alias);

    aliasToPrimary.set(alias, primary);
    const aliases = aliasesByPrimary.get(primary) || [];
    aliases.push({ name: alias, count: aliasMention.totalCount || 1 });
    aliasesByPrimary.set(primary, aliases);
  }

  return {
    mentions: [...mentionsByText.values()],
    aliasToPrimary,
    aliasesByPrimary,
  };
}

export function canonicalizeCharacterMentions(
  mentions: EntityMention[],
  aliasToPrimary: Map<string, string>
): EntityMention[] {
  if (aliasToPrimary.size === 0) return mentions;

  return mentions.map((mention) => {
    const primary = aliasToPrimary.get(mention.text);
    if (!primary) return mention;
    // Build aliasIndex entry for the remapped alias
    const aliasEntry: AliasIndexEntry = {
      alias: mention.text,
      chapterIndices: mention.allChapters || [mention.chapterIndex],
      count: mention.totalCount || 1,
    };
    const existingIndex = mention.aliasIndex || [];
    return {
      ...mention,
      text: primary,
      aliases: [...new Set([...(mention.aliases || []), mention.text])],
      aliasIndex: buildAliasIndex(existingIndex, [aliasEntry]),
    };
  });
}
