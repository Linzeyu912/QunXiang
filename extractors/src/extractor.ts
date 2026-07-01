import type { Character } from '@novel-agent/core';
import { cleanEntityDescription, mergeEntityDescriptions } from '@novel-agent/core';
import type { LLMProvider } from '@novel-agent/llm';
import {
  extractionResultSchema,
  type CharacterInputOutput,
  type ItemInputOutput,
  type LocationInputOutput,
} from '@novel-agent/schemas';
import { getDefaultProvider } from '@novel-agent/llm';
import {
  chooseCanonicalCharacterName,
  isCollectiveCharacterAlias,
  isSafeAliasMatch,
  isSafeSharedAliasMatch,
  sanitizeCharacterAliases,
} from '@novel-agent/entity-resolution';
import { extractCharacterSignals } from './character-signals.js';
import {
  CHARACTER_EXTRACTION_PROMPT,
  CHARACTER_BATCH_PROMPT,
} from '@novel-agent/prompts';

export interface Chapter {
  index: number;
  content: string;
  title?: string;
}

type CharacterCandidate = Omit<Character, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>;

// ItemCandidate mirrors ItemInputOutput — no DB-specific fields.
// Used internally by dedupItems before enrichment by calcImportance downstream.
type ItemCandidate = ItemInputOutput;

export interface BatchResult {
  batch: Chapter[];
  characters: CharacterInputOutput[];
  items: ItemInputOutput[];
  locations: LocationInputOutput[];
  error?: string;
}

export interface ExtractResult {
  characters: CharacterCandidate[];
  items: ItemInputOutput[];
  locations: LocationInputOutput[];
  failedBatches: BatchResult[];
  totalBatches: number;
  successfulBatches: number;
}

interface ProcessBatchResult {
  batchCharacters: CharacterInputOutput[];
  batchItems: ItemInputOutput[];
  batchLocations: LocationInputOutput[];
  batch: Chapter[];
  failedBatches?: BatchResult[];
  error?: string;
}

function envNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

// Batch size for processing large books (chapters per batch)
const BATCH_SIZE = envNumber('EXTRACTOR_BATCH_SIZE', 20);

// Retry count for failed batches
const MAX_RETRIES = envNumber('EXTRACTOR_MAX_RETRIES', 3);

// Max concurrent LLM calls (avoids overwhelming the API)
const MAX_CONCURRENT_BATCHES = envNumber('EXTRACTOR_MAX_CONCURRENT_BATCHES', 2);

// Outer guard so a provider request that never settles cannot stall the pipeline forever.
const BATCH_TIMEOUT_MS = envNumber('EXTRACTOR_BATCH_TIMEOUT_MS', 180_000);

// If a combined multi-chapter request drifts away from valid JSON, retry each chapter
// separately before accepting data loss for that span.
const SPLIT_FAILED_BATCHES = process.env.EXTRACTOR_SPLIT_FAILED_BATCHES !== '0';

function norm(s: string): string {
  return s.toLowerCase().trim();
}

function unique<T>(values: Array<T | null | undefined>): T[] {
  return [...new Set(values.filter((v): v is T => v != null))];
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
          timeoutMs
        );
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

/**
 * Find an already-collected character that refers to the same entity as `char`.
 * Match on: same name (case-insensitive), one's name in the other's aliases,
 * or a shared alias. This is what lets "萧炎" and a stray "萧炎哥" entry merge.
 */
function findDuplicateCharacter(
  char: CharacterCandidate,
  map: Map<string, CharacterCandidate>
): { key: string; character: CharacterCandidate } | null {
  const nameKey = norm(char.name);
  if (map.has(nameKey)) return { key: nameKey, character: map.get(nameKey)! };

  for (const [key, existing] of map) {
    if (isSafeAliasMatch(existing, char)) return { key, character: existing };
    if (isSafeSharedAliasMatch(existing, char)) return { key, character: existing };
  }
  return null;
}

function mergeCharacter(a: CharacterCandidate, b: CharacterCandidate): CharacterCandidate {
  const base = (a.confidence ?? 0) >= (b.confidence ?? 0) ? a : b;
  const other = base === a ? b : a;
  const chapters = unique([...(base.chapterAppearances || []), ...(other.chapterAppearances || [])]).sort(
    (x, y) => x - y
  );
  return {
    ...base,
    aliases: unique([...(base.aliases || []), ...(other.aliases || []), other.name]).filter(
      (al) => al !== base.name
    ),
    description: mergeEntityDescriptions(base.description, other.description),
    confidence: Math.max(a.confidence ?? 0, b.confidence ?? 0),
    firstChapter: chapters.length ? chapters[0] : base.firstChapter,
    lastChapter: chapters.length ? chapters[chapters.length - 1] : base.lastChapter,
    chapterAppearances: chapters,
  };
}

/** Deduplicate items by name (case-insensitive), merging aliases. */
function dedupItems(items: ItemInputOutput[]): ItemInputOutput[] {
  const map = new Map<string, ItemCandidate>();
  for (const item of items) {
    const key = norm(item.name);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...item, description: cleanEntityDescription(item.description) });
    } else {
      const chapters = unique([...(existing.chapterAppearances || []), ...(item.chapterAppearances || [])]).sort(
        (x, y) => x - y
      );
      map.set(key, {
        ...existing,
        aliases: unique([...(existing.aliases || []), ...(item.aliases || [])]).filter(
          (al) => al !== existing.name
        ),
        description: mergeEntityDescriptions(existing.description, item.description),
        confidence: Math.max(existing.confidence ?? 0, item.confidence ?? 0),
        firstChapter: chapters.length ? chapters[0] : existing.firstChapter,
        lastChapter: chapters.length ? chapters[chapters.length - 1] : existing.lastChapter,
        chapterAppearances: chapters,
      });
    }
  }
  return [...map.values()];
}

/** Deduplicate locations by name (case-insensitive), merging aliases. */
function dedupLocations(locations: LocationInputOutput[]): LocationInputOutput[] {
  const map = new Map<string, LocationInputOutput>();
  for (const loc of locations) {
    const key = norm(loc.name);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...loc, description: cleanEntityDescription(loc.description) });
    } else {
      const chapters = unique([...(existing.chapterAppearances || []), ...(loc.chapterAppearances || [])]).sort(
        (x, y) => x - y
      );
      map.set(key, {
        ...existing,
        aliases: unique([...(existing.aliases || []), ...(loc.aliases || [])]).filter(
          (al) => al !== existing.name
        ),
        description: mergeEntityDescriptions(existing.description, loc.description),
        confidence: Math.max(existing.confidence ?? 0, loc.confidence ?? 0),
        firstChapter: chapters.length ? chapters[0] : existing.firstChapter,
        lastChapter: chapters.length ? chapters[chapters.length - 1] : existing.lastChapter,
        chapterAppearances: chapters,
      });
    }
  }
  return [...map.values()];
}

/**
 * Create an extractor that uses the configured LLM provider to extract both
 * characters and items in a single call per batch. Implements batch-level
 * fault tolerance and alias-aware character dedup (so address forms like
 * "萧炎哥" merge into "萧炎" rather than surviving as separate entities).
 */
export function createExtractor() {
  return async function extractEntities(
    bookTitle: string,
    chapters: Chapter[]
  ): Promise<ExtractResult> {
    const provider = await getDefaultProvider();

    const allCharacters: CharacterInputOutput[] = [];
    const allItems: ItemInputOutput[] = [];
    const allLocations: LocationInputOutput[] = [];
    const failedBatches: BatchResult[] = [];
    const totalBatches = Math.ceil(chapters.length / BATCH_SIZE);

    // Build batch tasks
    const batchTasks: Array<{ batch: Chapter[]; batchNum: number }> = [];
    for (let i = 0; i < chapters.length; i += BATCH_SIZE) {
      batchTasks.push({
        batch: chapters.slice(i, i + BATCH_SIZE),
        batchNum: Math.floor(i / BATCH_SIZE) + 1,
      });
    }

    // Execute batches with a concurrency cap.
    const batchResults: Array<PromiseSettledResult<Awaited<ReturnType<typeof processBatch>>>> = [];
    for (let i = 0; i < batchTasks.length; i += MAX_CONCURRENT_BATCHES) {
      const group = batchTasks.slice(i, i + MAX_CONCURRENT_BATCHES);
      const groupResults = await Promise.allSettled(
        group.map((task) =>
          processBatch(provider, bookTitle, task.batch, task.batchNum, totalBatches)
        )
      );
      batchResults.push(...groupResults);
    }

    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        const { batchCharacters, batchItems, batchLocations, batch, failedBatches: recoveredFailures = [], error } = result.value;
        if (error) {
          failedBatches.push({ batch, characters: [], items: [], locations: [], error });
        } else {
          allCharacters.push(...batchCharacters);
          allItems.push(...batchItems);
          allLocations.push(...batchLocations);
          failedBatches.push(...recoveredFailures);
        }
      } else {
        failedBatches.push({
          batch: [],
          characters: [],
          items: [],
          locations: [],
          error: result.reason?.message || 'unknown',
        });
      }
    }

    // Process a single batch with retry logic
    async function processBatch(
      provider: Pick<LLMProvider, 'chatExtract'>,
      bookTitle: string,
      batch: Chapter[],
      batchNum: number,
      total: number,
      allowSplitRecovery = true
    ): Promise<ProcessBatchResult> {
      const bookContent = batch
        .map((c) => `Chapter ${c.index}${c.title ? `: ${c.title}` : ''}\n${c.content}`)
        .join('\n\n');
      const userPrompt = `${CHARACTER_BATCH_PROMPT(bookTitle, batchNum, total)}\n\n${bookContent}`;

      console.log(
        `[Extractor] Processing batch ${batchNum}/${total} (chapters ${batch[0].index}-${batch[batch.length - 1].index})`
      );

      for (let retry = 0; retry < MAX_RETRIES; retry++) {
        try {
          const result = await withTimeout(
            provider.chatExtract(
              CHARACTER_EXTRACTION_PROMPT,
              userPrompt,
              extractionResultSchema
            ),
            BATCH_TIMEOUT_MS,
            `Extractor batch ${batchNum}/${total}`
          );
          console.log(
            `[Extractor] Batch ${batchNum}/${total} completed (${(result.characters || []).length} chars, ${(result.items || []).length} items, ${(result.locations || []).length} locs)`
          );
          return {
            batchCharacters: (result.characters || []) as CharacterInputOutput[],
            batchItems: (result.items || []) as ItemInputOutput[],
            batchLocations: (result.locations || []) as LocationInputOutput[],
            batch,
          };
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          console.warn(
            `[Extractor] Batch ${batchNum}/${total} failed (attempt ${retry + 1}/${MAX_RETRIES}): ${msg}`
          );
          if (retry < MAX_RETRIES - 1) {
            await new Promise((r) => setTimeout(r, Math.pow(2, retry) * 1000));
          } else {
            if (allowSplitRecovery && SPLIT_FAILED_BATCHES && batch.length > 1) {
              return recoverFailedBatch(provider, bookTitle, batch, batchNum, total, msg);
            }
            return { batchCharacters: [], batchItems: [], batchLocations: [], batch, error: msg };
          }
        }
      }
      return { batchCharacters: [], batchItems: [], batchLocations: [], batch, error: 'unreachable' };
    }

    async function recoverFailedBatch(
      provider: Pick<LLMProvider, 'chatExtract'>,
      bookTitle: string,
      batch: Chapter[],
      batchNum: number,
      total: number,
      originalError: string
    ): Promise<ProcessBatchResult> {
      console.warn(
        `[Extractor] Batch ${batchNum}/${total} failed as a combined request; retrying ${batch.length} chapters individually`
      );

      const batchCharacters: CharacterInputOutput[] = [];
      const batchItems: ItemInputOutput[] = [];
      const batchLocations: LocationInputOutput[] = [];
      const failedChapters: Chapter[] = [];
      const errors: string[] = [];

      for (const chapter of batch) {
        const result = await processBatch(provider, bookTitle, [chapter], batchNum, total, false);
        if (result.error) {
          failedChapters.push(chapter);
          errors.push(`chapter ${chapter.index}: ${result.error}`);
          continue;
        }
        batchCharacters.push(...result.batchCharacters);
        batchItems.push(...result.batchItems);
        batchLocations.push(...result.batchLocations);
      }

      const failedBatches = failedChapters.length > 0
        ? [{
            batch: failedChapters,
            characters: [],
            items: [],
            locations: [],
            error: `Original batch failed: ${originalError}; split recovery failed: ${errors.join(' | ')}`,
          }]
        : [];

      return {
        batchCharacters,
        batchItems,
        batchLocations,
        batch,
        ...(failedBatches.length > 0 ? { failedBatches } : {}),
      };
    }

    const totalBatchesCount = Math.ceil(chapters.length / BATCH_SIZE);
    const successfulBatchesCount = totalBatchesCount - failedBatches.length;

    // Alias-aware character dedup (replaces the old exact-name-only dedup)
    const charMap = new Map<string, CharacterCandidate>();
    const sourceText = chapters.map((chapter) => chapter.content).join('\n');
    const knownCharacterNames = allCharacters.map((character) => character.name).filter(Boolean);
    const knownAliasesByCharacter = Object.fromEntries(
      allCharacters.map((character) => [character.name, character.aliases ?? []])
    );
    for (const c of allCharacters) {
      if (isCollectiveCharacterAlias(c.name)) continue;

      const canonicalName = chooseCanonicalCharacterName(c.name, c.aliases ?? [], { sourceText });
      const aliasPool = canonicalName === c.name
        ? c.aliases ?? []
        : [...(c.aliases ?? []), c.name];
      const cleanAliases = sanitizeCharacterAliases(canonicalName, aliasPool, {
        sourceText,
        knownCharacterNames,
        knownAliasesByCharacter,
      });
      const candidate: CharacterCandidate = {
        name: canonicalName,
        aliases: cleanAliases,
        description: cleanEntityDescription(c.description),
        confidence: c.confidence ?? 0,
        status: 'PENDING' as const,
        chapterRef: c.firstChapter?.toString(),
        firstChapter: c.firstChapter,
        lastChapter: c.lastChapter,
        chapterAppearances: c.chapterAppearances ?? [],
        mentionCount: 0,
        dialogueCount: 0,
        coCharacters: [],
      };
      const dup = findDuplicateCharacter(candidate, charMap);
      if (dup) {
        const merged = mergeCharacter(dup.character, candidate);
        charMap.delete(dup.key);
        charMap.set(norm(merged.name), merged);
      } else {
        charMap.set(norm(candidate.name), candidate);
      }
    }
    const characters = Array.from(charMap.values());

    // Signals (mention/dialogue/co-occurrence) computed from consolidated names+aliases.
    // Sum across main name + ALL aliases so mentionCount reflects total presence
    // (e.g. 萧薰儿 + 萧熏儿 + 薰儿 + 熏儿).
    const allNames = characters.flatMap((c) => [c.name, ...(c.aliases || [])]);
    const signals = extractCharacterSignals(chapters, allNames);
    // Map any name/alias back to its canonical (main) name so coCharacters always
    // refer to entities by main name. Handles "薰儿" vs "熏儿" / "萧薰儿" vs "萧熏儿"
    // — both end up as "萧薰儿" in coCharacters.
    const aliasToCanonical = new Map<string, string>();
    for (const c of characters) {
      aliasToCanonical.set(c.name, c.name);
      for (const a of c.aliases || []) aliasToCanonical.set(a, c.name);
    }
    const canonicalizeCo = (name: string): string => aliasToCanonical.get(name) || name;
    for (const c of characters) {
      const mainSig = signals.get(c.name);
      const aliasSigs = (c.aliases || [])
        .map((a) => signals.get(a))
        .filter((s): s is NonNullable<typeof s> => Boolean(s));
      c.mentionCount = (mainSig?.mentionCount ?? 0)
        + aliasSigs.reduce((sum, s) => sum + (s.mentionCount ?? 0), 0);
      c.dialogueCount = (mainSig?.dialogueCount ?? 0)
        + aliasSigs.reduce((sum, s) => sum + (s.dialogueCount ?? 0), 0);
      const selfNames = new Set([c.name, ...(c.aliases || [])]);
      c.coCharacters = [...new Set([
        ...(mainSig?.coCharacters ?? []),
        ...aliasSigs.flatMap((s) => s.coCharacters ?? []),
      ].map(canonicalizeCo))].filter((name) => !selfNames.has(name) && name !== c.name);
    }

    const items = dedupItems(allItems);
    const locations = dedupLocations(allLocations);

    return {
      characters,
      items,
      locations,
      failedBatches,
      totalBatches: totalBatchesCount,
      successfulBatches: successfulBatchesCount,
    };
  };
}

// Default extractor instance
export const extractEntities = createExtractor();
