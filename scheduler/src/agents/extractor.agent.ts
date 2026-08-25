import type { AgentType, Character, Location, Item, Owner, WorldviewSetting } from '@qunxiang/core';
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
  category?: string;
}

/** Map EntityImportance[] into DB-ready objects. The optional `enrich` map lets
 *  LLM-sourced entities (items) keep their LLM confidence/aliases/description
 *  instead of the prescan defaults (confidence 0.7, empty aliases). */
function mapEntitiesToDb(
  importances: EntityImportance[],
  descriptions: Map<string, string> = new Map(),
  enrich?: Map<string, EntityEnrichment>
) {
  return importances.map(imp => {
    const e = enrich?.get(imp.text);
    return {
      name: imp.text,
      aliases: e?.aliases ?? ([] as string[]),
      category: e?.category,
      description: e?.description ?? descriptions.get(imp.text) ?? undefined,
      confidence: e?.confidence ?? 0.7,
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
    useLLM: false, // Avoid double LLM call — extractor does its own pass
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
  const characters = fusedCharacters.filter((c) => c.mentionCount > 0 || c.dialogueCount > 0);
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

  /** Build prescan mention map + LLM mention list + enrichment, then score importance. */
  function llmEntitiesWithPrescan(
    llmEntities: { name: string; aliases?: string[]; description?: string; confidence?: number; category?: string; firstChapter?: number; lastChapter?: number; chapterAppearances?: number[] }[],
    prescanMentions: EntityMention[],
    entityType: EntityType,
  ): Omit<Location, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>[] {
    const prescanByName = new Map<string, EntityMention>();
    for (const m of prescanMentions) {
      for (const n of [m.text, ...(m.aliases || [])]) {
        const key = n.toLowerCase();
        if (!prescanByName.has(key)) prescanByName.set(key, m);
      }
    }

    const llmMentions: EntityMention[] = [];
    const enrich = new Map<string, EntityEnrichment>();
    for (const ent of llmEntities) {
      const matchKeys = [ent.name, ...(ent.aliases || [])].map((s) => s.toLowerCase());
      const matched = matchKeys.map((k) => prescanByName.get(k)).filter((m): m is EntityMention => Boolean(m));
      const chapters = [
        ...new Set([
          ...(ent.chapterAppearances || []),
          ...matched.flatMap((m) => m.allChapters && m.allChapters.length ? m.allChapters : [m.chapterIndex]),
        ]),
      ].sort((a, b) => a - b);
      const totalCount = matched.length
        ? Math.max(...matched.map((m) => m.totalCount || 1))
        : ent.chapterAppearances?.length || 1;

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
    return mapEntitiesToDb(importances, new Map(), enrich);
  }

  if (enhanced.prescanResult) {
    // Locations: LLM-primary, enriched with prescan mention count/chapter coverage.
    locations = llmEntitiesWithPrescan(entityResult.locations, enhanced.prescanResult.location, 'location');
    // Items: LLM-primary, enriched with prescan.
    items = llmEntitiesWithPrescan(entityResult.items, enhanced.prescanResult.item, 'item').map((it) => ({ ...it, owners: [] as Owner[] }));
    console.log(`[Extractor] Locations (LLM): ${locations.length}; Items (LLM): ${items.length}`);
  } else {
    // No prescan: entities still come from LLM, with neutral importance.
    const noPrescanMap = (
      ents: { name: string; aliases?: string[]; description?: string; confidence?: number; category?: string; firstChapter?: number; lastChapter?: number; chapterAppearances?: number[] }[],
      entityType: EntityType,
    ) => llmEntitiesWithPrescan(ents, [], entityType);
    locations = noPrescanMap(entityResult.locations, 'location');
    items = noPrescanMap(entityResult.items, 'item').map((it) => ({ ...it, owners: [] as Owner[] }));
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
    confidence: w.confidence ?? 0.7,
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
