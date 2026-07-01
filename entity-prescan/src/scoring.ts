/**
 * Confidence and scoring module for entity prescan.
 *
 * Calculates:
 * 1. 出现次数 (mention count)
 * 2. 位置特征 (position features)
 * 3. 分布广度 (distribution breadth)
 * 4. 语义与段落 (semantic & paragraph features)
 * 5. 基础统计量 (basic statistics)
 *
 * Then computes confidence and executes stratification & routing.
 */
import type { EntityMention, EntityType, ScanChapter } from './types.js';

// ─── Types ───

export interface ScoringParams {
  /** 出现次数 */
  mentionCount: number;
  /** 位置特征 */
  positionFeatures: PositionFeatures;
  /** 分布广度 */
  distributionBreadth: DistributionBreadth;
  /** 语义与段落 */
  semanticParagraph: SemanticParagraph;
  /** 基础统计量 */
  basicStats: BasicStats;
}

export interface PositionFeatures {
  /** 首次出现位置（归一化 0-1） */
  firstPosition: number;
  /** 末次出现位置（归一化 0-1） */
  lastPosition: number;
  /** 平均位置（归一化 0-1） */
  avgPosition: number;
  /** 位置方差（0-1，越大越分散） */
  positionVariance: number;
}

export interface DistributionBreadth {
  /** 出现章节数 */
  chapterCount: number;
  /** 总章节数 */
  totalChapters: number;
  /** 章节覆盖率（0-1） */
  chapterCoverage: number;
  /** 最大连续出现章节跨度 */
  maxConsecutiveSpan: number;
  /** 分布均匀度（0-1，越大越均匀） */
  distributionUniformity: number;
}

export interface SemanticParagraph {
  /** 上下文多样性（不同上下文的比例） */
  contextDiversity: number;
  /** 段落密度（每段出现次数） */
  paragraphDensity: number;
  /** 语义集中度（在特定语境中出现的集中程度） */
  semanticConcentration: number;
}

export interface BasicStats {
  /** 平均每章出现次数 */
  avgPerChapter: number;
  /** 出现次数标准差 */
  stdDev: number;
  /** 峰度（分布形状） */
  kurtosis: number;
  /** 偏度（分布不对称性） */
  skewness: number;
}

export interface ConfidenceScore {
  /** 综合置信度（0-1） */
  overall: number;
  /** 出现次数置信度 */
  mentionConfidence: number;
  /** 位置置信度 */
  positionConfidence: number;
  /** 分布置信度 */
  distributionConfidence: number;
  /** 语义置信度 */
  semanticConfidence: number;
  /** 降权因子 */
  penaltyFactors: PenaltyFactors;
}

export interface PenaltyFactors {
  /** 出现次数不足惩罚 */
  insufficientMentions: number;
  /** 可替代性过高惩罚 */
  highSubstitutability: number;
  /** 评分分歧大惩罚 */
  highScoreVariance: number;
}

// ─── Calculation Functions ───

/**
 * Calculate position features.
 * Where in the text the entity appears.
 */
export function calcPositionFeatures(
  mentions: EntityMention[],
  chapters: ScanChapter[]
): PositionFeatures {
  if (mentions.length === 0) {
    return { firstPosition: 0, lastPosition: 0, avgPosition: 0, positionVariance: 0 };
  }

  const totalChapters = chapters.length;
  const positions = mentions.map(m => m.chapterIndex / Math.max(1, totalChapters - 1));

  const firstPosition = Math.min(...positions);
  const lastPosition = Math.max(...positions);
  const avgPosition = positions.reduce((s, p) => s + p, 0) / positions.length;

  // Position variance
  const variance = positions.reduce((s, p) => s + Math.pow(p - avgPosition, 2), 0) / positions.length;
  const positionVariance = Math.min(1, variance * 10); // normalize

  return { firstPosition, lastPosition, avgPosition, positionVariance };
}

/**
 * Calculate distribution breadth.
 * How spread the entity is across chapters.
 */
export function calcDistributionBreadth(
  mentions: EntityMention[],
  chapters: ScanChapter[]
): DistributionBreadth {
  const totalChapters = chapters.length;
  const entityChapters = [...new Set(mentions.map(m => m.chapterIndex))].sort((a, b) => a - b);
  const chapterCount = entityChapters.length;
  const chapterCoverage = chapterCount / Math.max(1, totalChapters);

  // Max consecutive span
  let maxConsecutiveSpan = 0;
  let currentSpan = 1;
  for (let i = 1; i < entityChapters.length; i++) {
    if (entityChapters[i] === entityChapters[i - 1] + 1) {
      currentSpan++;
    } else {
      maxConsecutiveSpan = Math.max(maxConsecutiveSpan, currentSpan);
      currentSpan = 1;
    }
  }
  maxConsecutiveSpan = Math.max(maxConsecutiveSpan, currentSpan);

  // Distribution uniformity: how evenly spread across chapters
  // If entity appears in equally spaced chapters, uniformity is high
  let uniformity = 0;
  if (chapterCount > 1) {
    const expectedGap = totalChapters / chapterCount;
    const gaps = [];
    for (let i = 1; i < entityChapters.length; i++) {
      gaps.push(entityChapters[i] - entityChapters[i - 1]);
    }
    const avgGap = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    const gapVariance = gaps.reduce((s, g) => s + Math.pow(g - avgGap, 2), 0) / gaps.length;
    uniformity = Math.max(0, 1 - Math.sqrt(gapVariance) / expectedGap);
  }

  return {
    chapterCount,
    totalChapters,
    chapterCoverage,
    maxConsecutiveSpan,
    distributionUniformity: uniformity,
  };
}

/**
 * Calculate semantic & paragraph features.
 */
export function calcSemanticParagraph(
  mentions: EntityMention[],
  chapters: ScanChapter[]
): SemanticParagraph {
  if (mentions.length === 0) {
    return { contextDiversity: 0, paragraphDensity: 0, semanticConcentration: 0 };
  }

  // Context diversity: unique bigrams in entity's context
  const contextBigrams = new Set<string>();
  for (const m of mentions) {
    const chapter = chapters.find(c => c.index === m.chapterIndex);
    if (chapter && m.position >= 0) {
      const pos = m.position;
      const window = chapter.content.slice(Math.max(0, pos - 50), pos + 50);
      for (let i = 0; i < window.length - 1; i++) {
        if (/[一-鿿]/.test(window[i]) && /[一-鿿]/.test(window[i + 1])) {
          contextBigrams.add(window.slice(i, i + 2));
        }
      }
    }
  }
  const contextDiversity = Math.min(1, contextBigrams.size / (mentions.length * 10));

  // Paragraph density: mentions per chapter
  const chapterMentions = new Map<number, number>();
  for (const m of mentions) {
    chapterMentions.set(m.chapterIndex, (chapterMentions.get(m.chapterIndex) || 0) + 1);
  }
  const avgMentionsPerChapter = mentions.length / Math.max(1, chapterMentions.size);
  const paragraphDensity = Math.min(1, avgMentionsPerChapter / 5);

  // Semantic concentration: how concentrated in specific chapters
  const counts = Array.from(chapterMentions.values());
  const maxCount = Math.max(...counts);
  const totalCount = counts.reduce((s, c) => s + c, 0);
  const semanticConcentration = totalCount > 0 ? maxCount / totalCount : 0;

  return { contextDiversity, paragraphDensity, semanticConcentration };
}

/**
 * Calculate basic statistics.
 */
export function calcBasicStats(
  mentions: EntityMention[],
  chapters: ScanChapter[]
): BasicStats {
  const totalChapters = chapters.length;
  const chapterMentions = new Map<number, number>();
  for (const m of mentions) {
    chapterMentions.set(m.chapterIndex, (chapterMentions.get(m.chapterIndex) || 0) + 1);
  }

  // Per-chapter counts (including zeros)
  const counts: number[] = [];
  for (let i = 0; i < totalChapters; i++) {
    counts.push(chapterMentions.get(i) || 0);
  }

  const avgPerChapter = mentions.length / Math.max(1, totalChapters);

  // Standard deviation
  const variance = counts.reduce((s, c) => s + Math.pow(c - avgPerChapter, 2), 0) / counts.length;
  const stdDev = Math.sqrt(variance);

  // Kurtosis (excess kurtosis)
  const m4 = counts.reduce((s, c) => s + Math.pow(c - avgPerChapter, 4), 0) / counts.length;
  const kurtosis = stdDev > 0 ? m4 / Math.pow(stdDev, 4) - 3 : 0;

  // Skewness
  const m3 = counts.reduce((s, c) => s + Math.pow(c - avgPerChapter, 3), 0) / counts.length;
  const skewness = stdDev > 0 ? m3 / Math.pow(stdDev, 3) : 0;

  return { avgPerChapter, stdDev, kurtosis, skewness };
}

/**
 * Calculate all scoring parameters for an entity.
 * Uses totalCount and allChapters if available (from confidence filter).
 */
export function calcScoringParams(
  mentions: EntityMention[],
  chapters: ScanChapter[]
): ScoringParams {
  // Use totalCount and allChapters if available (from confidence filter dedup)
  const totalCount = mentions[0]?.totalCount || mentions.length;
  const allChapters = mentions[0]?.allChapters || [...new Set(mentions.map(m => m.chapterIndex))];

  // Create expanded mentions for position/distribution calculations
  const expandedMentions: EntityMention[] = allChapters.map(chIdx => ({
    ...mentions[0],
    chapterIndex: chIdx,
  }));

  return {
    mentionCount: totalCount,
    positionFeatures: calcPositionFeatures(expandedMentions, chapters),
    distributionBreadth: calcDistributionBreadth(expandedMentions, chapters),
    semanticParagraph: calcSemanticParagraph(expandedMentions, chapters),
    basicStats: calcBasicStats(expandedMentions, chapters),
  };
}

// ─── Confidence Calculation ───

/**
 * Calculate confidence score based on the document's formula.
 *
 * Confidence is reduced by:
 * 1. 出现次数不足 (insufficient mentions)
 * 2. 可替代性过高 (high substitutability)
 * 3. 评分分歧大 (high score variance)
 */
export function calcConfidence(
  params: ScoringParams,
  allEntities: Map<string, ScoringParams>
): ConfidenceScore {
  // 1. Mention confidence: sigmoid-like function
  //    Low count → low confidence, high count → high confidence
  //    More lenient: 3+ mentions = full confidence
  const mentionConfidence = Math.min(1, params.mentionCount / 3);

  // 2. Position confidence: entities appearing throughout text are more reliable
  //    More lenient: any position gives some confidence
  const positionConfidence = Math.max(0.3, params.positionFeatures.positionVariance * 0.5 +
    (1 - Math.abs(params.positionFeatures.avgPosition - 0.5)) * 0.5);

  // 3. Distribution confidence: broader distribution = higher confidence
  //    More lenient: even 1 chapter gives some confidence
  const distributionConfidence = Math.min(1, params.distributionBreadth.chapterCoverage * 5) * 0.6 +
    params.distributionBreadth.distributionUniformity * 0.4;

  // 4. Semantic confidence: diverse context = higher confidence
  //    More lenient: any context gives some confidence
  const semanticConfidence = Math.max(0.3, params.semanticParagraph.contextDiversity * 0.5 +
    (1 - params.semanticParagraph.semanticConcentration) * 0.5);

  // Penalty factors
  const penaltyFactors: PenaltyFactors = {
    // 出现次数不足: if mention count < 2, apply penalty
    insufficientMentions: params.mentionCount < 2 ? 0.7 : 1,

    // 可替代性过高: if many similar entities exist
    highSubstitutability: calcSubstitutability(params, allEntities),

    // 评分分歧大: if basic stats show high variance
    highScoreVariance: params.basicStats.stdDev > 3 ? 0.8 : 1,
  };

  // Overall confidence with penalties
  const rawConfidence = (
    mentionConfidence * 0.3 +
    positionConfidence * 0.2 +
    distributionConfidence * 0.3 +
    semanticConfidence * 0.2
  );

  // Apply penalties
  const overall = rawConfidence *
    penaltyFactors.insufficientMentions *
    penaltyFactors.highSubstitutability *
    penaltyFactors.highScoreVariance;

  return {
    overall: Math.min(1, Math.max(0, overall)),
    mentionConfidence,
    positionConfidence,
    distributionConfidence,
    semanticConfidence,
    penaltyFactors,
  };
}

/**
 * Calculate substitutability penalty.
 * If many entities have similar patterns, reduce confidence.
 */
function calcSubstitutability(
  params: ScoringParams,
  allEntities: Map<string, ScoringParams>
): number {
  if (allEntities.size <= 1) return 1;

  // Check if other entities have similar mention counts and distribution
  let similarCount = 0;
  for (const [_, other] of allEntities) {
    if (other === params) continue;
    const countSimilar = Math.abs(other.mentionCount - params.mentionCount) <= 2;
    const distSimilar = Math.abs(other.distributionBreadth.chapterCoverage - params.distributionBreadth.chapterCoverage) < 0.1;
    if (countSimilar && distSimilar) similarCount++;
  }

  // More similar entities = higher substitutability = lower confidence
  return Math.max(0.5, 1 - similarCount * 0.1);
}

// ─── Stratification & Routing ───

export type Tier = 'core' | 'supporting' | 'candidate' | 'archived';

/**
 * Execute stratification and routing based on importance and confidence.
 *
 * Rules from the document:
 * - Core: importance >= 0.7 AND confidence >= 0.3
 * - Supporting: importance >= 0.5 AND confidence >= 0.2
 * - Candidate: importance >= 0.3
 * - Archived: everything else
 */
export function stratifyAndRoute(
  importance: number,
  confidence: number,
  storyScore: number
): { tier: Tier; route: 'main' | 'staging' | 'archive' } {
  // Stratification by importance and confidence
  let tier: Tier;
  if (importance >= 0.7 && confidence >= 0.3) {
    tier = 'core';
  } else if (importance >= 0.5 && confidence >= 0.2) {
    tier = 'supporting';
  } else if (importance >= 0.3) {
    tier = 'candidate';
  } else {
    tier = 'archived';
  }

  // Routing
  let route: 'main' | 'staging' | 'archive';
  if (tier === 'core' || tier === 'supporting') {
    route = 'main';
  } else if (tier === 'candidate') {
    route = 'staging';
  } else {
    route = 'archive';
  }

  return { tier, route };
}
