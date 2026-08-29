import type { Character, Outfit, Owner } from '@qunxiang/core';
import { cleanEntityDescription, inferItemCategory, mergeEntityDescriptions } from '@qunxiang/core';
import type { LLMProvider } from '@qunxiang/llm';
import {
  extractionResultSchema,
  type CharacterInputOutput,
  type ItemInputOutput,
  type LocationInputOutput,
  type WorldviewInputOutput,
} from '@qunxiang/schemas';
import { getDefaultProvider } from '@qunxiang/llm';
import {
  chooseCanonicalCharacterName,
  implicitCharacterSignalAliases,
  isCollectiveCharacterAlias,
  isGenericCharacterAlias,
  kinshipNormalize,
  sanitizeCharacterAliases,
} from '@qunxiang/entity-resolution';
import { extractCharacterSignals } from './character-signals.js';
import {
  CHARACTER_EXTRACTION_PROMPT,
  CHARACTER_BATCH_PROMPT,
} from '@qunxiang/prompts';

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
  worldviews: WorldviewInputOutput[];
  error?: string;
}

export interface ExtractResult {
  characters: CharacterCandidate[];
  items: ItemInputOutput[];
  locations: LocationInputOutput[];
  worldviews: WorldviewInputOutput[];
  failedBatches: BatchResult[];
  totalBatches: number;
  successfulBatches: number;
}

interface ProcessBatchResult {
  batchCharacters: CharacterInputOutput[];
  batchItems: ItemInputOutput[];
  batchLocations: LocationInputOutput[];
  batchWorldviews: WorldviewInputOutput[];
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
const MAX_CONCURRENT_BATCHES = envNumber('EXTRACTOR_MAX_CONCURRENT_BATCHES', 4);

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

function uniqueImplicitAliasesByCharacter(
  characters: Array<{ name: string }>
): Map<string, string[]> {
  const rawAliases = new Map<string, string[]>();
  const aliasCounts = new Map<string, number>();

  for (const character of characters) {
    const aliases = unique(implicitCharacterSignalAliases(character.name));
    rawAliases.set(character.name, aliases);
    for (const alias of aliases) {
      aliasCounts.set(alias, (aliasCounts.get(alias) ?? 0) + 1);
    }
  }

  return new Map(
    [...rawAliases].map(([name, aliases]) => [
      name,
      aliases.filter((alias) => aliasCounts.get(alias) === 1),
    ])
  );
}

function minDefined(a: number | undefined, b: number | undefined): number | undefined {
  if (a == null) return b;
  if (b == null) return a;
  return Math.min(a, b);
}

function maxDefined(a: number | undefined, b: number | undefined): number | undefined {
  if (a == null) return b;
  if (b == null) return a;
  return Math.max(a, b);
}

/**
 * Merge two outfits lists (cross-batch / cross-alias). Two outfits are treated
 * as the same set when their normalized scene labels match, or one description
 * contains the other. On match: union the chapter range and keep the longer
 * description. Otherwise append.
 */
function mergeOutfits(a?: Outfit[] | null, b?: Outfit[] | null): Outfit[] {
  const acc: Outfit[] = (a || []).map((o) => ({ ...o }));
  for (const o of b || []) {
    const oScene = o.scene ? norm(o.scene) : '';
    const oDesc = norm(o.description);
    const match = acc.find((x) => {
      const xScene = x.scene ? norm(x.scene) : '';
      if (oScene && xScene && oScene === xScene) return true;
      const xDesc = norm(x.description);
      return Boolean(xDesc && oDesc && (xDesc.includes(oDesc) || oDesc.includes(xDesc)));
    });
    if (match) {
      if ((o.description || '').length > (match.description || '').length) match.description = o.description;
      if (!match.scene && o.scene) match.scene = o.scene;
      match.firstChapter = minDefined(match.firstChapter, o.firstChapter);
      match.lastChapter = maxDefined(match.lastChapter, o.lastChapter);
    } else {
      acc.push({ ...o });
    }
  }
  return acc;
}

/** Merge two owner lists (cross-batch) by normalized owner name, unioning chapter ranges. */
function mergeOwners(a?: Owner[] | null, b?: Owner[] | null): Owner[] {
  const acc: Owner[] = (a || []).map((o) => ({ ...o }));
  for (const o of b || []) {
    const key = norm(o.name);
    const match = acc.find((x) => norm(x.name) === key);
    if (match) {
      if (!match.canonicalName && o.canonicalName) match.canonicalName = o.canonicalName;
      if (!match.note && o.note) match.note = o.note;
      match.firstChapter = minDefined(match.firstChapter, o.firstChapter);
      match.lastChapter = maxDefined(match.lastChapter, o.lastChapter);
    } else {
      acc.push({ ...o });
    }
  }
  return acc;
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
 * Exact canonical names merge automatically; 亲属称谓归一后的键（"X的妈妈"≡"X的母亲"）
 * 同样安全合并。Alias, title, and address-form matches must remain separate for
 * human review.（亲属词表与等价判定见 @qunxiang/entity-resolution 的 kinship.ts，
 * 与别名清洗共用同一份规则。）
 */
function findDuplicateCharacter(
  char: CharacterCandidate,
  map: Map<string, CharacterCandidate>
): { key: string; character: CharacterCandidate } | null {
  const nameKey = norm(kinshipNormalize(char.name));
  return map.has(nameKey) ? { key: nameKey, character: map.get(nameKey)! } : null;
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
    outfits: mergeOutfits(base.outfits, other.outfits),
  };
}

/** Deduplicate items by name (case-insensitive), merging aliases. */
function dedupItems(items: ItemInputOutput[]): ItemInputOutput[] {
  const map = new Map<string, ItemCandidate>();
  for (const item of items) {
    const key = norm(item.name);
    const existing = map.get(key);
    // 如果 LLM 没有返回 category 或返回了 other，尝试根据名称+描述推断
    const inferredCategory = (!item.category || item.category === 'other')
      ? inferItemCategory(item.name, item.description)
      : item.category;
    if (!existing) {
      map.set(key, { ...item, category: inferredCategory, description: cleanEntityDescription(item.description) });
    } else {
      const chapters = unique([...(existing.chapterAppearances || []), ...(item.chapterAppearances || [])]).sort(
        (x, y) => x - y
      );
      // 大类合并：具体类别优先于默认的 other
      const mergedCategory = existing.category && existing.category !== 'other' ? existing.category : inferredCategory;
      map.set(key, {
        ...existing,
        aliases: unique([...(existing.aliases || []), ...(item.aliases || [])]).filter(
          (al) => al !== existing.name
        ),
        description: mergeEntityDescriptions(existing.description, item.description),
        confidence: Math.max(existing.confidence ?? 0, item.confidence ?? 0),
        category: mergedCategory,
        firstChapter: chapters.length ? chapters[0] : existing.firstChapter,
        lastChapter: chapters.length ? chapters[chapters.length - 1] : existing.lastChapter,
        chapterAppearances: chapters,
        owners: mergeOwners(existing.owners, item.owners),
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

/** 世界观/体系设定跨批去重：按名称（大小写不敏感）合并别名、章节区间与描述。 */
function dedupWorldviews(worldviews: WorldviewInputOutput[]): WorldviewInputOutput[] {
  const map = new Map<string, WorldviewInputOutput>();
  for (const w of worldviews) {
    const key = norm(w.name);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...w, description: cleanEntityDescription(w.description) });
    } else {
      const chapters = unique([...(existing.chapterAppearances || []), ...(w.chapterAppearances || [])]).sort(
        (x, y) => x - y
      );
      map.set(key, {
        ...existing,
        aliases: unique([...(existing.aliases || []), ...(w.aliases || [])]).filter(
          (al) => al !== existing.name
        ),
        description: mergeEntityDescriptions(existing.description, w.description),
        confidence: Math.max(existing.confidence ?? 0, w.confidence ?? 0),
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
/** 提取进度回调：批次完成时上报（供管道阶段卡显示"第 X/N 批"） */
export interface ExtractionProgress {
  completedBatches: number;
  totalBatches: number;
  bookTitle: string;
}

export interface ExtractorOptions {
  onProgress?: (progress: ExtractionProgress) => void;
}

export function createExtractor(options: ExtractorOptions = {}) {
  return async function extractEntities(
    bookTitle: string,
    chapters: Chapter[]
  ): Promise<ExtractResult> {
    const provider = await getDefaultProvider();

    const allCharacters: CharacterInputOutput[] = [];
    const allItems: ItemInputOutput[] = [];
    const allLocations: LocationInputOutput[] = [];
    const allWorldviews: WorldviewInputOutput[] = [];
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
        const { batchCharacters, batchItems, batchLocations, batchWorldviews, batch, failedBatches: recoveredFailures = [], error } = result.value;
        if (error) {
          failedBatches.push({ batch, characters: [], items: [], locations: [], worldviews: [], error });
        } else {
          allCharacters.push(...batchCharacters);
          allItems.push(...batchItems);
          allLocations.push(...batchLocations);
          allWorldviews.push(...batchWorldviews);
          failedBatches.push(...recoveredFailures);
        }
      } else {
        failedBatches.push({
          batch: [],
          characters: [],
          items: [],
          locations: [],
          worldviews: [],
          error: result.reason?.message || 'unknown',
        });
      }
      // 每批落定（成功或失败）都上报一次进度
      const completedBatches = batchResults.length;
      options.onProgress?.({ completedBatches, totalBatches, bookTitle });
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
            `[实体提取] 批次 ${batchNum}/${total} 已完成（角色 ${(result.characters || []).length}，道具 ${(result.items || []).length}，场景 ${(result.locations || []).length}，世界观 ${(result.worldviews || []).length}）`
          );
          return {
            batchCharacters: (result.characters || []) as CharacterInputOutput[],
            batchItems: (result.items || []) as ItemInputOutput[],
            batchLocations: (result.locations || []) as LocationInputOutput[],
            batchWorldviews: (result.worldviews || []) as WorldviewInputOutput[],
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
            return { batchCharacters: [], batchItems: [], batchLocations: [], batchWorldviews: [], batch, error: msg };
          }
        }
      }
      return { batchCharacters: [], batchItems: [], batchLocations: [], batchWorldviews: [], batch, error: 'unreachable' };
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
      const batchWorldviews: WorldviewInputOutput[] = [];
      const failedChapters: Chapter[] = [];
      const errors: string[] = [];

      // 并发重试各章：原先 for-await 逐章串行，N 章要 N 轮 LLM 调用，失败兜底时极慢。
      // 各章互相独立，allSettled 并发即可；结果按原顺序归并到 batch* 数组。
      const settled = await Promise.allSettled(
        batch.map((chapter) => processBatch(provider, bookTitle, [chapter], batchNum, total, false)),
      );
      settled.forEach((item, i) => {
        const chapter = batch[i];
        if (item.status === 'fulfilled') {
          const result = item.value;
          if (result.error) {
            failedChapters.push(chapter);
            errors.push(`chapter ${chapter.index}: ${result.error}`);
          } else {
            batchCharacters.push(...result.batchCharacters);
            batchItems.push(...result.batchItems);
            batchLocations.push(...result.batchLocations);
            batchWorldviews.push(...result.batchWorldviews);
          }
        } else {
          failedChapters.push(chapter);
          errors.push(
            `chapter ${chapter.index}: ${item.reason instanceof Error ? item.reason.message : String(item.reason)}`,
          );
        }
      });

      const failedBatches = failedChapters.length > 0
        ? [{
            batch: failedChapters,
            characters: [],
            items: [],
            locations: [],
            worldviews: [],
            error: `Original batch failed: ${originalError}; split recovery failed: ${errors.join(' | ')}`,
          }]
        : [];

      return {
        batchCharacters,
        batchItems,
        batchLocations,
        batchWorldviews,
        batch,
        ...(failedBatches.length > 0 ? { failedBatches } : {}),
      };
    }

    const totalBatchesCount = Math.ceil(chapters.length / BATCH_SIZE);
    const successfulBatchesCount = totalBatchesCount - failedBatches.length;

    // Alias-aware character dedup (replaces the old exact-name-only dedup)
    const charMap = new Map<string, CharacterCandidate>();
    const kinKey = (name: string) => norm(kinshipNormalize(name));
    const sourceText = chapters.map((chapter) => chapter.content).join('\n');
    const knownCharacterNames = allCharacters.map((character) => character.name).filter(Boolean);
    const knownAliasesByCharacter = Object.fromEntries(
      allCharacters.map((character) => [character.name, character.aliases ?? []])
    );
    for (const c of allCharacters) {
      if (isCollectiveCharacterAlias(c.name)) continue;

      const chosen = chooseCanonicalCharacterName(c.name, c.aliases ?? [], {
        sourceText,
        knownCharacterNames,
      });
      if (isCollectiveCharacterAlias(chosen) || isGenericCharacterAlias(chosen)) continue;
      // 亲属称谓归一："X的妈妈"统一命名为"X的母亲"，原写法收进别名，跨批变体才能合并
      const canonicalName = kinshipNormalize(chosen);
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
        outfits: c.outfits ?? [],
      };
      const dup = findDuplicateCharacter(candidate, charMap);
      if (dup) {
        const merged = mergeCharacter(dup.character, candidate);
        charMap.delete(dup.key);
        charMap.set(kinKey(merged.name), merged);
      } else {
        charMap.set(kinKey(candidate.name), candidate);
      }
    }
    let characters = Array.from(charMap.values());

    // 集合称谓去冗余："X的父母"在"X的父亲"与"X的母亲"都已单独存在时是重复行，丢弃
    const kinKeySet = new Set(characters.map((ch) => kinKey(ch.name)));
    characters = characters.filter((ch) => {
      const n = kinshipNormalize(ch.name);
      const idx = n.lastIndexOf('的');
      if (idx <= 0 || n.slice(idx + 1) !== '父母') return true;
      const prefix = n.slice(0, idx);
      return !(kinKeySet.has(norm(`${prefix}的父亲`)) && kinKeySet.has(norm(`${prefix}的母亲`)));
    });

    // Signals (mention/dialogue/co-occurrence) computed from consolidated names+aliases.
    // Sum across main name + ALL aliases so mentionCount reflects total presence
    // (e.g. 萧薰儿 + 萧熏儿 + 薰儿 + 熏儿).
    const implicitAliasesByCharacter = uniqueImplicitAliasesByCharacter(characters);
    const allNames = unique(characters.flatMap((c) => [
      c.name,
      ...(c.aliases || []),
      ...(implicitAliasesByCharacter.get(c.name) ?? []),
    ]));
    const signals = extractCharacterSignals(chapters, allNames);
    // Map any name/alias back to its canonical (main) name so coCharacters always
    // refer to entities by main name. Handles "薰儿" vs "熏儿" / "萧薰儿" vs "萧熏儿"
    // — both end up as "萧薰儿" in coCharacters.
    const aliasToCanonical = new Map<string, string>();
    for (const c of characters) {
      aliasToCanonical.set(c.name, c.name);
      for (const a of c.aliases || []) aliasToCanonical.set(a, c.name);
      for (const a of implicitAliasesByCharacter.get(c.name) ?? []) aliasToCanonical.set(a, c.name);
    }
    const canonicalizeCo = (name: string): string => aliasToCanonical.get(name) || name;
    for (const c of characters) {
      const signalAliases = unique([
        ...(c.aliases || []),
        ...(implicitAliasesByCharacter.get(c.name) ?? []),
      ]);
      const mainSig = signals.get(c.name);
      const aliasSigs = signalAliases
        .map((a) => signals.get(a))
        .filter((s): s is NonNullable<typeof s> => Boolean(s));
      c.mentionCount = (mainSig?.mentionCount ?? 0)
        + aliasSigs.reduce((sum, s) => sum + (s.mentionCount ?? 0), 0);
      c.dialogueCount = (mainSig?.dialogueCount ?? 0)
        + aliasSigs.reduce((sum, s) => sum + (s.dialogueCount ?? 0), 0);
      const selfNames = new Set([c.name, ...signalAliases]);
      c.coCharacters = [...new Set([
        ...(mainSig?.coCharacters ?? []),
        ...aliasSigs.flatMap((s) => s.coCharacters ?? []),
      ].map(canonicalizeCo))].filter((name) => !selfNames.has(name) && name !== c.name);
    }

    const items = dedupItems(allItems);
    const locations = dedupLocations(allLocations);
    const worldviews = dedupWorldviews(allWorldviews);

    return {
      characters,
      items,
      locations,
      worldviews,
      failedBatches,
      totalBatches: totalBatchesCount,
      successfulBatches: successfulBatchesCount,
    };
  };
}

// Default extractor instance
export const extractEntities = createExtractor();
