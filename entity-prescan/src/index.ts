/**
 * @novel-agent/entity-prescan
 *
 * Entity pre-scanning module. Sits between chapter-analysis and extractors
 * in the pipeline. Uses regex + LLM to extract 4 entity types:
 * character, location, item, event.
 *
 * Pipeline: regex scan → role discovery merge → LLM completion →
 * alias canonicalization → confidence filter → importance analysis → write files
 */

export { scanCharacterEntities, scanFrequentCharacterEntities } from './scanners/character.js';
export { scanLocationEntities } from './scanners/location.js';
export { scanItemEntities } from './scanners/item.js';
export { scanEventEntities } from './scanners/event.js';
export { discoverFullTextCharacterMentions, canonicalizeCharacterMentions } from './role-discovery.js';
export { llmComplete } from './llm-completion.js';
export { writeEntityFiles, writeEntityFilesToDir, readEntityFiles } from './writer.js';
export { filterByConfidence, type ConfidenceOptions } from './confidence.js';
export { calcImportance, type EntityImportance, type PillarScores, type ProductionValue, type ImportanceOptions } from './importance.js';
export { calcScoringParams, calcConfidence, stratifyAndRoute, type ScoringParams, type ConfidenceScore, type PenaltyFactors, type Tier } from './scoring.js';
export { selectOutputEntities } from './selection.js';

export type {
  EntityMention,
  EntityType,
  PrescanResult,
  PrescanOptions,
  ScanChapter,
  TypeStats,
} from './types.js';

import { scanCharacterEntities } from './scanners/character.js';
import { scanLocationEntities } from './scanners/location.js';
import { scanItemEntities } from './scanners/item.js';
import { scanEventEntities } from './scanners/event.js';
import { discoverFullTextCharacterMentions, canonicalizeCharacterMentions } from './role-discovery.js';
import { llmComplete } from './llm-completion.js';
import { formatEntityText, writeEntityFiles, writeEntityFilesToDir } from './writer.js';
import { filterByConfidence } from './confidence.js';
import { calcImportance, type EntityImportance } from './importance.js';
import { calcScoringParams, calcConfidence, stratifyAndRoute, type ScoringParams, type ConfidenceScore } from './scoring.js';
import { selectOutputEntities } from './selection.js';
import type {
  EntityMention,
  EntityType,
  PrescanResult,
  PrescanOptions,
  ScanChapter,
  TypeStats,
} from './types.js';

/**
 * Run the full entity pre-scan pipeline on analyzed chapters.
 *
 * Steps:
 * 1. Regex scan all chapters for 4 entity types
 * 2. (Optional) LLM completion to find missed entities
 * 3. Full-text role discovery merged into character entities
 * 4. Confidence filtering (remove low-confidence entities)
 * 5. Importance analysis (three-pillar scoring + classification)
 * 6. Write results to output/{bookId}/
 *
 * @param chapters - chapters to scan (from import pipeline)
 * @param options - prescan configuration
 * @returns PrescanResult with all entities and stats
 */
export async function prescanEntities(
  chapters: ScanChapter[],
  options: PrescanOptions
): Promise<PrescanResult> {
  const startTime = Date.now();
  const { bookId, outputDir = 'output', outputPath, useLLM = true, batchSize = 10, storyWeight = 0.7, prodWeight = 0.3 } = options;

  // ── Step 1: Regex scan ──

  const regexResults = new Map<number, Map<EntityType, EntityMention[]>>();
  const regexTotals: Map<EntityType, number> = new Map([
    ['character', 0], ['location', 0], ['item', 0], ['event', 0],
  ]);

  const allRegexMentions: Map<EntityType, EntityMention[]> = new Map([
    ['character', []],
    ['location', []],
    ['item', []],
    ['event', []],
  ]);

  for (const chapter of chapters) {
    const chapterResults = new Map<EntityType, EntityMention[]>();

    const charMentions = scanCharacterEntities(chapter);
    const locMentions = scanLocationEntities(chapter);
    const itemMentions = scanItemEntities(chapter);
    const eventMentions = scanEventEntities(chapter);

    chapterResults.set('character', charMentions);
    chapterResults.set('location', locMentions);
    chapterResults.set('item', itemMentions);
    chapterResults.set('event', eventMentions);

    regexResults.set(chapter.index, chapterResults);

    // Accumulate
    allRegexMentions.get('character')!.push(...charMentions);
    allRegexMentions.get('location')!.push(...locMentions);
    allRegexMentions.get('item')!.push(...itemMentions);
    allRegexMentions.get('event')!.push(...eventMentions);

    regexTotals.set('character', regexTotals.get('character')! + charMentions.length);
    regexTotals.set('location', regexTotals.get('location')! + locMentions.length);
    regexTotals.set('item', regexTotals.get('item')! + itemMentions.length);
    regexTotals.set('event', regexTotals.get('event')! + eventMentions.length);
  }

  const roleDiscovery = discoverFullTextCharacterMentions(chapters);
  allRegexMentions.get('character')!.push(...roleDiscovery.mentions);
  regexTotals.set('character', regexTotals.get('character')! + roleDiscovery.mentions.length);

  // ── Step 2: LLM completion (optional) ──

  let llmTotals: Map<EntityType, number> = new Map([
    ['character', 0], ['location', 0], ['item', 0], ['event', 0],
  ]);

  const mergedResults = new Map<EntityType, EntityMention[]>(allRegexMentions);

  if (useLLM) {
    try {
      const { mentions: llmMentions } = await llmComplete(chapters, regexResults, batchSize);

      // Merge LLM results into final
      for (const [type, mentions] of llmMentions) {
        const existing = mergedResults.get(type) || [];
        existing.push(...mentions);
        mergedResults.set(type, existing);
        llmTotals.set(type, mentions.length);
      }
    } catch (error) {
      console.warn(`[entity-prescan] LLM completion skipped: ${error instanceof Error ? error.message : error}`);
    }
  }

  const characterMentions = mergedResults.get('character') || [];
  mergedResults.set(
    'character',
    canonicalizeCharacterMentions(characterMentions, roleDiscovery.aliasToPrimary)
  );

  // ── Step 3: Confidence filtering ──

  const filteredResults = filterByConfidence(mergedResults, {
    minConfidence: 0.6,
    minMentions: 1,
  });

  // ── Step 4: Scoring parameters & confidence ──

  const scoringResults = new Map<EntityType, Map<string, { params: ScoringParams; confidence: ConfidenceScore }>>();

  for (const [type, mentions] of filteredResults) {
    // Group by text
    const grouped = new Map<string, EntityMention[]>();
    for (const m of mentions) {
      if (!grouped.has(m.text)) grouped.set(m.text, []);
      grouped.get(m.text)!.push(m);
    }

    const typeScoring = new Map<string, { params: ScoringParams; confidence: ConfidenceScore }>();

    // First pass: calculate all params
    const allParams = new Map<string, ScoringParams>();
    for (const [text, group] of grouped) {
      const params = calcScoringParams(group, chapters);
      allParams.set(text, params);
    }

    // Second pass: calculate confidence (needs all params for substitutability)
    for (const [text, params] of allParams) {
      const confidence = calcConfidence(params, allParams);
      typeScoring.set(text, { params, confidence });
    }

    scoringResults.set(type, typeScoring);
  }

  // ── Step 5: Importance analysis ──

  const importanceResults = calcImportance(filteredResults, chapters, { storyWeight, prodWeight });

  // ── Step 5: Write files ──

  const outputResults = selectOutputEntities(filteredResults, importanceResults, scoringResults);

  if (outputPath) {
    await writeEntityFilesToDir(outputPath, outputResults);
  } else {
    await writeEntityFiles(bookId, outputResults, outputDir);
  }

  // Also write importance report
  const { writeFile, mkdir } = await import('fs/promises');
  const { resolve } = await import('path');
  const bookDir = outputPath ? resolve(outputPath) : resolve(outputDir, bookId);
  await mkdir(bookDir, { recursive: true });

  // Write importance report
  const importanceLines: string[] = [];

  // Header
  importanceLines.push('# 实体重要性分析报告');
  importanceLines.push('# 格式: 实体|重要性|置信度|分层|分流|因果|唯一|转折|storyScore|storyValue|呈现价值|提及|章节');
  importanceLines.push('# 分层: core=核心 / supporting=支撑 / candidate=候选 / archived=归档');
  importanceLines.push('# 分流: main=主表 / staging=暂存区 / archive=归档');
  importanceLines.push(`# Importance = ${storyWeight} × storyValue + ${prodWeight} × productionValue`);
  importanceLines.push('# storyValue: 三支柱 storyScore(0-6) 查表/归一化后的故事评分');
  importanceLines.push('# 置信度: 基于出现次数、位置特征、分布广度、语义段落、基础统计量');
  importanceLines.push('# 三支柱: 因果必要性(行为驱动+不可替代) + 信息唯一性(语义相似度反向) + 状态转折性(情感+关系+转折词)');

  for (const [type, importances] of importanceResults) {
    importanceLines.push(`\n=== ${type.toUpperCase()} (${importances.length}条) ===`);
    importanceLines.push('实体|重要性|置信度|分层|分流|因果|唯一|转折|storyScore|storyValue|呈现价值|提及|章节');

    for (const imp of importances) {
      const scoring = scoringResults.get(type)?.get(imp.text);
      const confidence = scoring?.confidence.overall ?? 0;
      const { tier, route } = stratifyAndRoute(imp.importance, confidence, imp.storyScore);

      importanceLines.push(
        `${formatEntityText(type, imp)}|${imp.importance.toFixed(3)}|${confidence.toFixed(3)}|${tier}|${route}|` +
        `${imp.pillars.causalNecessity}|${imp.pillars.informationUniqueness}|${imp.pillars.stateTransition}|` +
        `${imp.storyScore}|${imp.storyValue.toFixed(2)}|${imp.production.score.toFixed(2)}|` +
        `${imp.mentionCount}|${imp.chapters.join(',')}`
      );
    }

    // Summary for this type
    const tierCounts = { core: 0, supporting: 0, candidate: 0, archived: 0 };
    const routeCounts = { main: 0, staging: 0, archive: 0 };
    for (const imp of importances) {
      const scoring = scoringResults.get(type)?.get(imp.text);
      const confidence = scoring?.confidence.overall ?? 0;
      const { tier, route } = stratifyAndRoute(imp.importance, confidence, imp.storyScore);
      tierCounts[tier]++;
      routeCounts[route]++;
    }
    importanceLines.push(`[分层统计] core=${tierCounts.core} supporting=${tierCounts.supporting} candidate=${tierCounts.candidate} archived=${tierCounts.archived}`);
    importanceLines.push(`[分流统计] main=${routeCounts.main} staging=${routeCounts.staging} archive=${routeCounts.archive}`);
  }
  await writeFile(resolve(bookDir, 'importance.txt'), importanceLines.join('\n') + '\n', 'utf-8');

  // ── Build stats ──

  const durationMs = Date.now() - startTime;

  const buildTypeStats = (type: EntityType): TypeStats => ({
    regexCount: regexTotals.get(type) || 0,
    llmCount: llmTotals.get(type) || 0,
    afterDedup: outputResults.get(type)?.length || 0,
  });

  return {
    character: outputResults.get('character') || [],
    location: outputResults.get('location') || [],
    item: outputResults.get('item') || [],
    event: outputResults.get('event') || [],
    stats: {
      character: buildTypeStats('character'),
      location: buildTypeStats('location'),
      item: buildTypeStats('item'),
      event: buildTypeStats('event'),
      durationMs,
    },
  };
}
