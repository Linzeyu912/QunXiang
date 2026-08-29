import type { AgentType, Character, Location, Item, Owner, WorldviewSetting } from '@qunxiang/core';
import { calibrateConfidence, inferItemCategory } from '@qunxiang/core';
import { createExtractor } from '@qunxiang/extractors';
import { BookRepository, getSharedAssetSourceResolver } from '@qunxiang/storage';
import { parseTxtEnhanced } from '@qunxiang/import';
import { calcImportance, type EntityImportance, type EntityType } from '@qunxiang/entity-prescan';
import { bookSlug } from '@qunxiang/story-arcs';
import { join } from 'path';
import { fuseCharactersWithPrescan } from './character-fusion.js';
import {
  extractCharacterDescriptionPacks,
  extractItemDescriptionPacks,
  extractLocationDescriptionPacks,
  type CharacterDescriptionPack,
  type ItemDescriptionPack,
  type LocationDescriptionPack,
} from './entity-descriptions.js';

export const extractorAgentType: AgentType = 'extractor';

export interface ExtractorPayload {
  bookId: string;
}

export interface ExtractorResult {
  characters: Omit<Character, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>[];
  locations: Omit<Location, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>[];
  items: Omit<Item, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>[];
  worldviews?: Omit<WorldviewSetting, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>[];
  events?: import('@qunxiang/entity-prescan').EntityMention[];
  runDirName?: string;
  characterDescriptions?: CharacterDescriptionPack[];
  itemDescriptions?: ItemDescriptionPack[];
  locationDescriptions?: LocationDescriptionPack[];
  failedBatches?: { batch: number; error: string }[];
  totalBatches?: number;
  successfulBatches?: number;
}

/** Per-entity LLM fields to preserve when mapping importance results to DB rows */
interface EntityEnrichment {
  confidence?: number;
  aliases?: string[];
  description?: string;
  category?: Item['category'];
}

/** 首次出现处的原文片段（前后各约30字），供低置信度库人工判断参考 */
function findFirstMentionSnippet(
  chaptersList: Array<{ index: number; content: string }>,
  names: string[],
): string | undefined {
  const distinct = [...new Set(names.map((s) => s.trim()).filter((s) => s.length >= 2))];
  for (const ch of chaptersList) {
    for (const n of distinct) {
      const idx = ch.content.indexOf(n);
      if (idx < 0) continue;
      const start = Math.max(0, idx - 30);
      const end = Math.min(ch.content.length, idx + n.length + 30);
      const snippet = ch.content.slice(start, end).replace(/\s+/g, ' ').trim();
      return `第${ch.index}章：…${snippet}…`;
    }
  }
  return undefined;
}

/** Map EntityImportance[] into DB-ready objects. The optional `enrich` map lets
 *  LLM-sourced entities (items) keep their LLM aliases/description instead of
 *  the prescan defaults. Confidence is always evidence-calibrated — the raw
 *  LLM self-report clusters at 0.85+ regardless of entity prominence. */
function mapEntitiesToDb(
  importances: EntityImportance[],
  descriptions: Map<string, string> = new Map(),
  enrich?: Map<string, EntityEnrichment>,
  totalChapters?: number,
) {
  return importances.map(imp => {
    const e = enrich?.get(imp.text);
    return {
      name: imp.text,
      aliases: e?.aliases ?? ([] as string[]),
      category: e?.category,
      description: e?.description ?? descriptions.get(imp.text) ?? undefined,
      confidence: calibrateConfidence(e?.confidence, {
        mentionCount: imp.mentionCount,
        chapterCount: imp.chapters.length,
        totalChapters,
      }),
      status: 'PENDING' as const,
      chapterRef: imp.chapters.length > 0 ? `第${imp.chapters[0]}章` : undefined,
      importanceScore: imp.importance,
      tier: imp.tier as 'core' | 'supporting' | 'candidate' | 'archived',
      storyScore: imp.storyScore,
      productionScore: imp.production.score,
      pillarCausal: imp.pillars.causalNecessity,
      pillarUniqueness: imp.pillars.informationUniqueness,
      pillarTransition: imp.pillars.stateTransition,
      mentionCount: imp.mentionCount,
      firstChapter: imp.chapters.length > 0 ? Math.min(...imp.chapters) : undefined,
      lastChapter: imp.chapters.length > 0 ? Math.max(...imp.chapters) : undefined,
      chapterAppearances: imp.chapters,
    };
  });
}

export async function executeExtractor(payload: unknown): Promise<ExtractorResult> {
  const { bookId } = payload as ExtractorPayload;

  // Fetch book metadata
  const book = await BookRepository.findById(bookId);
  if (!book) {
    throw new Error(`Book not found: ${bookId}`);
  }

  // Read content via resolver（对象存储优先，旧书 filePath 只读回退）
  const content = await getSharedAssetSourceResolver().readSourceText(book);

  // Use a readable directory name (from book title) + timestamp to avoid
  // overwriting previous runs' output. Each run gets its own directory.
  const bookDir = bookSlug(book.title) || bookId;
  const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12); // YYYYMMDDHHmm
  const runDirName = `${bookDir}-${ts}`;

  // Parse TXT with enhanced pipeline (includes prescan)
  // Prescan intermediate files go to .intermediate/ (not output/) — keeps
  // output/ clean for final user-facing results only.
  const enhanced = await parseTxtEnhanced(content, book.title, {
    bookId,
    prescanOutputPath: join('.intermediate', runDirName, 'prescan'),
  });

  const chapters = enhanced.chapters.map(ch => ({
    index: ch.index,
    title: ch.title,
    content: ch.content,
  }));

  // LLM extraction of characters + items in a single call per batch
  const extractEntities = createExtractor();
  const entityResult = await extractEntities(enhanced.title, chapters);

  console.log(`[Extractor] Batches: ${entityResult.successfulBatches}/${entityResult.totalBatches} successful`);
  if (entityResult.failedBatches.length > 0) {
    console.warn(`[Extractor] ${entityResult.failedBatches.length} batches failed`);
  }

  const fusedCharacters = fuseCharactersWithPrescan(
    entityResult.characters,
    enhanced.prescanResult?.character || []
  );

  // Filter out LLM-hallucinated characters: 0 mentions + 0 dialogue means the
  // character doesn't appear in the text at all (LLM made them up).
  // 置信度统一做证据校准：LLM 自报值对主角和一次性的路人角色都给 0.85+，
  // 不校准的话低置信度库形同虚设（库为空的根因）。
  const characters = fusedCharacters
    .filter((c) => c.mentionCount > 0 || c.dialogueCount > 0)
    .map((c) => ({
      ...c,
      confidence: calibrateConfidence(c.confidence, {
        mentionCount: c.mentionCount || 0,
        chapterCount: (c.chapterAppearances || []).length,
        dialogueCount: c.dialogueCount || 0,
        totalChapters: chapters.length,
      }),
      firstMentionSnippet: findFirstMentionSnippet(chapters, [c.name, ...(c.aliases || [])]),
    }));
  const droppedChars = fusedCharacters.filter((c) => c.mentionCount === 0 && c.dialogueCount === 0);
  if (droppedChars.length > 0) {
    console.log(`[Extractor] Filtered ${droppedChars.length} hallucinated characters: ${droppedChars.map((c) => c.name).join('、')}`);
  }
  console.log(`[Extractor] Fused characters: LLM ${entityResult.characters.length}, prescan ${enhanced.prescanResult?.character.length || 0}, final ${characters.length}; LLM items ${entityResult.items.length}`);

  // Both items and locations are LLM-primary: the LLM decides the entity set;
  // prescan only enriches mention count / chapter coverage for matching entities.
  let locations: Omit<Location, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>[] = [];
  let items: Omit<Item, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>[] = [];

  const prescanChapters = enhanced.chapters.map(ch => ({
    index: ch.index,
    title: ch.title,
    content: ch.content,
  }));

  type EntityMention = import('@qunxiang/entity-prescan').EntityMention;

  /** Location 形状 + 可选 category（道具行有、场景行无），与 mapEntitiesToDb 的实际产出一致 */
  type PrescanEnrichedEntity = Omit<Location, 'id' | 'bookId' | 'createdAt' | 'updatedAt'> & {
    category?: Item['category'];
  };

  /** Build prescan mention map + LLM mention list + enrichment, then score importance. */
  function llmEntitiesWithPrescan(
    llmEntities: { name: string; aliases?: string[]; description?: string; confidence?: number; category?: Item['category']; firstChapter?: number; lastChapter?: number; chapterAppearances?: number[] }[],
    prescanMentions: EntityMention[],
    entityType: EntityType,
  ): PrescanEnrichedEntity[] {
    const prescanByName = new Map<string, EntityMention>();
    for (const m of prescanMentions) {
      for (const n of [m.text, ...(m.aliases || [])]) {
        const key = n.toLowerCase();
        if (!prescanByName.has(key)) prescanByName.set(key, m);
      }
    }

    // 全文计数回填：预扫描正则按玄幻题材设计，现代都市书的场景/道具名几乎抓不到，
    // 提及次数会被记成 LLM 声明的章节数（1-2 次），证据被严重低估、置信度成片
    // 落进低置信度库。这里用「名称+别名全文子串计数」作为兜底证据，取三者最大值。
    const textMentionCache = new Map<string, { count: number; chapters: number[] }>();
    function countInText(names: string[]): { count: number; chapters: number[] } {
      const key = names.join('\u0000');
      const cached = textMentionCache.get(key);
      if (cached) return cached;
      const distinct = [...new Set(names.map((s) => s.trim()).filter((s) => s.length >= 2))];
      let count = 0;
      const chaptersHit: number[] = [];
      for (const ch of prescanChapters) {
        let perChapter = 0;
        for (const n of distinct) {
          let from = 0;
          for (;;) {
            const idx = ch.content.indexOf(n, from);
            if (idx < 0) break;
            perChapter++;
            from = idx + n.length;
          }
        }
        if (perChapter > 0) chaptersHit.push(ch.index);
        count += perChapter;
      }
      const result = { count, chapters: chaptersHit };
      textMentionCache.set(key, result);
      return result;
    }

    const llmMentions: EntityMention[] = [];
    const enrich = new Map<string, EntityEnrichment>();
    for (const ent of llmEntities) {
      const matchKeys = [ent.name, ...(ent.aliases || [])].map((s) => s.toLowerCase());
      const matched = matchKeys.map((k) => prescanByName.get(k)).filter((m): m is EntityMention => Boolean(m));
      const textMention = countInText([ent.name, ...(ent.aliases || [])]);
      const chapters = [
        ...new Set([
          ...(ent.chapterAppearances || []),
          ...matched.flatMap((m) => m.allChapters && m.allChapters.length ? m.allChapters : [m.chapterIndex]),
          ...textMention.chapters,
        ]),
      ].sort((a, b) => a - b);
      const totalCount = Math.max(
        matched.length ? Math.max(...matched.map((m) => m.totalCount || 1)) : 0,
        ent.chapterAppearances?.length || 0,
        textMention.count,
      );

      llmMentions.push({
        text: ent.name,
        chapterIndex: ent.firstChapter ?? chapters[0] ?? 0,
        position: 0,
        source: 'llm',
        confidence: ent.confidence ?? 0.7,
        totalCount,
        allChapters: chapters,
        aliases: ent.aliases ?? [],
      });
      enrich.set(ent.name, {
        confidence: ent.confidence ?? 0.7,
        aliases: ent.aliases ?? [],
        description: ent.description,
        category: ent.category,
      });
    }

    const entityMap = new Map<EntityType, EntityMention[]>();
    entityMap.set(entityType, llmMentions);
    const importances = calcImportance(entityMap, prescanChapters).get(entityType) || [];
    return mapEntitiesToDb(importances, new Map(), enrich, prescanChapters.length).map((row) => ({
      ...row,
      firstMentionSnippet: findFirstMentionSnippet(prescanChapters, [row.name, ...(row.aliases || [])]),
    }));
  }

  if (enhanced.prescanResult) {
    // Locations: LLM-primary, enriched with prescan mention count/chapter coverage.
    locations = llmEntitiesWithPrescan(entityResult.locations, enhanced.prescanResult.location, 'location');
    // Items: LLM-primary, enriched with prescan.
    // 末端兜底：即使 enrich 映射意外丢失 category（或值为 other），
    // 也按名称+描述再推断一次，保证入库道具不会成片落在"其他物品"。
    items = llmEntitiesWithPrescan(entityResult.items, enhanced.prescanResult.item, 'item').map((it) => ({
      ...it,
      category:
        it.category && it.category !== 'other'
          ? it.category
          : inferItemCategory(it.name, it.description),
      owners: [] as Owner[],
    }));
    console.log(`[Extractor] Locations (LLM): ${locations.length}; Items (LLM): ${items.length}`);
  } else {
    // No prescan: entities still come from LLM, with neutral importance.
    const noPrescanMap = (
      ents: { name: string; aliases?: string[]; description?: string; confidence?: number; category?: Item['category']; firstChapter?: number; lastChapter?: number; chapterAppearances?: number[] }[],
      entityType: EntityType,
    ) => llmEntitiesWithPrescan(ents, [], entityType);
    locations = noPrescanMap(entityResult.locations, 'location');
    items = noPrescanMap(entityResult.items, 'item').map((it) => ({
      ...it,
      category:
        it.category && it.category !== 'other'
          ? it.category
          : inferItemCategory(it.name, it.description),
      owners: [] as Owner[],
    }));
  }

  const characterDescriptions = extractCharacterDescriptionPacks(characters, chapters);
  const itemDescriptions = extractItemDescriptionPacks(items, chapters);
  const locationDescriptions = extractLocationDescriptionPacks(locations, chapters);
  console.log(`[Extractor] Entity descriptions: characters=${characterDescriptions.length}, items=${itemDescriptions.length}, locations=${locationDescriptions.length}`);

  // 世界观/体系设定：LLM 主提取（extractors 已跨批去重），不参与 prescan 重要性打分，
  // 中性 importance/tier，入库后由人工审核分级。mentionCount 取章节证据数。
  const worldviews: Omit<WorldviewSetting, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>[] = (
    entityResult.worldviews || []
  ).map((w) => ({
    name: w.name,
    aliases: Array.isArray(w.aliases) ? w.aliases : [],
    category: w.category || 'worldview',
    description: w.description,
    // 世界观无独立提及计数，用章节证据数近似；世界观列表不过滤低置信度，仅统一指标口径
    confidence: calibrateConfidence(w.confidence, {
      mentionCount: (w.chapterAppearances || []).length,
      chapterCount: (w.chapterAppearances || []).length,
      totalChapters: chapters.length,
    }),
    status: 'PENDING' as const,
    chapterRef: w.firstChapter != null ? `第${w.firstChapter}章` : undefined,
    importanceScore: 0,
    tier: 'candidate' as const,
    mentionCount: (w.chapterAppearances || []).length,
    firstChapter: w.firstChapter,
    lastChapter: w.lastChapter,
    chapterAppearances: w.chapterAppearances ?? [],
  }));
  console.log(`[实体提取] 世界观设定：${worldviews.length}`);

  return {
    characters,
    locations,
    items,
    worldviews,
    events: enhanced.prescanResult?.event || [],
    runDirName,
    characterDescriptions,
    itemDescriptions,
    locationDescriptions,
    failedBatches: entityResult.failedBatches.map((b, i) => ({
      batch: i,
      error: b.error || 'Unknown error',
    })),
    totalBatches: entityResult.totalBatches,
    successfulBatches: entityResult.successfulBatches,
  };
}
