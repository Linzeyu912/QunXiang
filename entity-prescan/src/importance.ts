/**
 * Importance scoring for entity prescan results.
 * Based on the three-pillar scoring system from the handover document.
 *
 * Three Pillars (each 0-2, total 0-6 → storyScore → storyValue):
 * 1. Causal Necessity (因果必要性) = behaviorDrive + irreplaceability
 * 2. Information Uniqueness (信息唯一性) = semanticSimilarityReverse
 * 3. State Transition (状态转折性) = emotionVolatility + relationChange + transitionDensity
 *
 * Final: Importance = storyWeight × storyValue + prodWeight × productionValue
 */
import type { EntityMention, EntityType, ScanChapter } from './types.js';

// ─── Types ───

export interface PillarScores {
  /** 因果必要性: 行为驱动度 + 不可替代性 (0-2) */
  causalNecessity: number;
  /** 信息唯一性: 语义相似度反向 (0-2) */
  informationUniqueness: number;
  /** 状态转折性: 情感波动 + 关系变动 + 转折词密度 (0-2) */
  stateTransition: number;
}

export interface ProductionValue {
  /** 写作完成度: 描写细节、感官密度 (0-1) */
  writingCompleteness: number;
  /** 改编可用性: 空间、动作、对话 (0-1) */
  adaptationUsability: number;
  /** Combined score (0-1) */
  score: number;
}

export interface EntityImportance {
  /** Entity text */
  text: string;
  /** Canonical character aliases merged into this entity */
  aliases?: string[];
  /** Entity type */
  type: EntityType;
  /** Three pillar scores */
  pillars: PillarScores;
  /** storyScore = sum of pillars (0-6) */
  storyScore: number;
  /** Normalized story score from the handover formula lookup (0-1) */
  storyValue: number;
  /** Production value */
  production: ProductionValue;
  /** Final importance = storyWeight * storyValue + prodWeight * production.score (0-1) */
  importance: number;
  /** Classification tier */
  tier: 'core' | 'supporting' | 'candidate' | 'archived';
  /** Classification quadrant */
  quadrant: 'core' | 'supporting' | 'candidate' | 'archived';
  /** Mention count */
  mentionCount: number;
  /** Chapter appearances */
  chapters: number[];
}

// ─── Pillar 1: Causal Necessity (因果必要性) ───

/**
 * Calculate behavior drive score (行为驱动度).
 * Measures how much the entity drives plot actions.
 * Uses relative ranking: entities with more mentions/actions score higher.
 */
function calcBehaviorDrive(
  mentions: EntityMention[],
  chapters: ScanChapter[],
  allMentionCounts: number[],  // all entity mention counts for percentile ranking
  type: EntityType
): number {
  const totalCount = mentions[0]?.totalCount || mentions.length;
  const chapterIndices = mentions[0]?.allChapters || [...new Set(mentions.map(m => m.chapterIndex))];
  const chapterCount = chapterIndices.length;
  const totalChapters = Math.max(1, chapters.length);

  // Frequency is useful, but it should not let one-off calendar/location
  // entries dominate the causal pillar by itself.
  const sorted = [...allMentionCounts].sort((a, b) => a - b);
  const rank = sorted.filter(c => c <= totalCount).length / sorted.length;
  const frequencyScore = Math.min(1, Math.log1p(totalCount) / Math.log1p(20));

  // Chapter spread relative to total (0-1), capped to keep long-running
  // supporting assets from automatically becoming causal.
  const chapterSpread = Math.min(1, chapterCount / Math.max(1, totalChapters * 0.12));

  // Action verb co-occurrence density
  const actionVerbs = '说笑道怒喝骂问答走来去出入开关抓拿推拉打杀救保护帮助攻击防守';
  let actionCount = 0;
  let windowsWithAction = 0;
  for (const m of mentions) {
    const chapter = chapters.find(c => c.index === m.chapterIndex);
    if (chapter && m.position >= 0) {
      const pos = m.position;
      const window = chapter.content.slice(Math.max(0, pos - 50), pos + 50);
      let hasAction = false;
      for (const ch of window) {
        if (actionVerbs.includes(ch)) { actionCount++; hasAction = true; }
      }
      if (hasAction) windowsWithAction++;
    }
  }
  const actionDensity = mentions.length > 0 ? windowsWithAction / mentions.length : 0;

  const typeActionWeight: Record<EntityType, number> = {
    character: 0.45,
    event: 0.50,
    item: 0.30,
    location: 0.20,
  };
  const actionWeight = typeActionWeight[type] ?? 0.3;
  const frequencyWeight = type === 'event' ? 0.20 : 0.35;
  const spreadWeight = Math.max(0, 1 - actionWeight - frequencyWeight);

  // Blend percentile and log-scaled frequency. Both are bounded 0-1.
  const mentionScore = rank * 0.4 + frequencyScore * 0.6;
  return mentionScore * frequencyWeight + chapterSpread * spreadWeight + actionDensity * actionWeight;
}

/**
 * Calculate irreplaceability score (不可替代性).
 * Measures how unique the entity is (not replaceable by similar entities).
 * Stricter: only truly unique names score high.
 */
function calcIrreplaceability(text: string, allEntities: string[]): number {
  // Name length (2-char names are common, 3-4 char names are more unique)
  const lengthScore = text.length <= 2 ? 0.3 : text.length <= 3 ? 0.7 : 1.0;

  // Check if name contains common characters
  const commonChars = '人事物地方天地大小多少好坏新旧高低长短快慢冷热';
  let commonCount = 0;
  for (const ch of text) {
    if (commonChars.includes(ch)) commonCount++;
  }
  const uniqueScore = Math.max(0, 1 - commonCount * 0.4);

  // Check if name is substring of other entities (confusable)
  let similarCount = 0;
  for (const other of allEntities) {
    if (other !== text && (other.includes(text) || text.includes(other))) {
      similarCount++;
    }
  }
  const distinctScore = Math.max(0, 1 - similarCount * 0.3);

  return lengthScore * 0.25 + uniqueScore * 0.35 + distinctScore * 0.4;
}

// ─── Pillar 2: Information Uniqueness (信息唯一性) ───

/**
 * Calculate information uniqueness score.
 * Measures how much unique information the entity carries.
 * Method: compare entity's local context with the REST of the text
 * (excluding chapters where the entity appears).
 * High uniqueness = entity's context has vocabulary not found elsewhere.
 */
function calcInfoUniqueness(
  mentions: EntityMention[],
  chapters: ScanChapter[]
): number {
  if (mentions.length === 0) return 0;

  // Entity's chapter indices
  const entityChapters = new Set(mentions.map(m => m.chapterIndex));

  // Get bigrams from entity's context (surrounding text)
  const entityBigrams = new Set<string>();
  for (const m of mentions) {
    const chapter = chapters.find(c => c.index === m.chapterIndex);
    if (chapter && m.position >= 0) {
      const pos = m.position;
      const window = chapter.content.slice(Math.max(0, pos - 150), pos + 150);
      for (let i = 0; i < window.length - 1; i++) {
        if (/[一-鿿]/.test(window[i]) && /[一-鿿]/.test(window[i + 1])) {
          entityBigrams.add(window.slice(i, i + 2));
        }
      }
    }
  }

  // Get bigrams from the REST of the text (excluding entity's chapters)
  const restBigrams = new Set<string>();
  for (const ch of chapters) {
    if (entityChapters.has(ch.index)) continue;  // skip entity's own chapters
    for (let i = 0; i < ch.content.length - 1; i++) {
      if (/[一-鿿]/.test(ch.content[i]) && /[一-鿿]/.test(ch.content[i + 1])) {
        restBigrams.add(ch.content.slice(i, i + 2));
      }
    }
  }

  // Count bigrams unique to entity context (not in rest)
  let uniqueToEntity = 0;
  for (const bg of entityBigrams) {
    if (!restBigrams.has(bg)) uniqueToEntity++;
  }

  // Uniqueness ratio: what fraction of entity's context is unique
  const uniqueness = entityBigrams.size > 0 ? uniqueToEntity / entityBigrams.size : 0;

  // The handover formula says this pillar is the reverse of semantic similarity.
  // A singleton should not get a free bonus merely for being concentrated; it
  // needs genuinely distinctive local context.
  const contextVolume = Math.min(1, entityBigrams.size / 80);
  return uniqueness * 0.85 + contextVolume * 0.15;
}

// ─── Pillar 3: State Transition (状态转折性) ───

/** Emotion keywords for volatility detection */
const EMOTION_WORDS = '笑哭怒悲惊恐惧喜乐忧愁苦痛伤感动愤恨怨怒惊慌忙乱恐惧怕爱恨愁急慌忙呆傻疯狂怨惊怒怕爱恨愁急慌忙呆傻疯狂怨';

/** Transition keywords for density detection */
const TRANSITION_WORDS = '但是然而可是只是不过突然忽然竟然居然果然显然当然必然终于最后后来然后从此于是因此所以如果虽然尽管即使因为所以';

/**
 * Calculate state transition score.
 * Measures if the entity marks irreversible state changes.
 * Based on: emotion volatility + relation change + transition density.
 */
function calcStateTransition(
  mentions: EntityMention[],
  chapters: ScanChapter[]
): number {
  if (mentions.length === 0) return 0;

  let emotionCount = 0;
  let transitionCount = 0;
  let totalWindows = 0;

  for (const m of mentions) {
    const chapter = chapters.find(c => c.index === m.chapterIndex);
    if (chapter && m.position >= 0) {
      const pos = m.position;
      const window = chapter.content.slice(Math.max(0, pos - 100), pos + 100);
      totalWindows++;

      // Count emotion words in window
      for (const ch of window) {
        if (EMOTION_WORDS.includes(ch)) emotionCount++;
      }

      // Count transition words in window
      for (const word of TRANSITION_WORDS) {
        if (window.includes(word)) transitionCount++;
      }
    }
  }

  // Normalize
  const emotionRatio = totalWindows > 0 ? Math.min(1, emotionCount / (totalWindows * 3)) : 0;
  const transitionRatio = totalWindows > 0 ? Math.min(1, transitionCount / (totalWindows * 2)) : 0;

  // Relation change: check if entity appears with multiple other entities
  const chaptersSet = new Set(mentions.map(m => m.chapterIndex));
  const relationScore = Math.min(1, chaptersSet.size / (chapters.length * 0.3));

  return emotionRatio * 0.4 + transitionRatio * 0.3 + relationScore * 0.3;
}

// ─── Production Value ───

/**
 * Calculate production value.
 * Measures writing completeness and adaptation usability.
 */
function calcProductionValue(
  mentions: EntityMention[],
  chapters: ScanChapter[],
  type: EntityType
): ProductionValue {
  if (mentions.length === 0) {
    return { writingCompleteness: 0, adaptationUsability: 0, score: 0 };
  }

  let detailCount = 0;
  let dialogueCount = 0;
  let actionCount = 0;
  let spaceCount = 0;
  let totalWindows = 0;
  const totalCount = mentions[0]?.totalCount || mentions.length;
  const chapterIndices = mentions[0]?.allChapters || [...new Set(mentions.map(m => m.chapterIndex))];

  const DETAIL_WORDS = [
    '详细', '仔细', '清楚', '明白', '看见', '听见', '闻到', '触摸',
    '感觉', '疼痛', '冰冷', '滚烫', '血腥', '香味', '颜色', '模样',
  ];
  const SPACE_WORDS = [
    '屋内', '屋外', '院子', '街道', '城门', '衙门', '牢房', '大厅',
    '房间', '楼上', '楼下', '远处', '近处', '旁边', '周围',
  ];
  const ACTION_WORDS = [
    '追杀', '袭击', '交手', '审问', '调查', '出手', '逃走', '救下',
    '打伤', '击杀', '抓住', '下令', '派遣', '拔刀', '挥刀',
  ];

  for (const m of mentions) {
    const chapter = chapters.find(c => c.index === m.chapterIndex);
    if (chapter && m.position >= 0) {
      const pos = m.position;
      const window = chapter.content.slice(Math.max(0, pos - 100), pos + 100);
      totalWindows++;

      for (const word of DETAIL_WORDS) {
        if (window.includes(word)) detailCount++;
      }

      // Dialogue (quotes)
      const quotes = window.match(/[“"][^”"]+[”"]/g) || [];
      dialogueCount += quotes.length;

      for (const word of ACTION_WORDS) {
        if (window.includes(word)) actionCount++;
      }

      for (const word of SPACE_WORDS) {
        if (window.includes(word)) spaceCount++;
      }
    }
  }

  // Writing completeness: detail + sensory density
  const writingCompleteness = totalWindows > 0
    ? Math.min(1, (detailCount + dialogueCount) / (totalWindows * 4))
    : 0;

  // Adaptation usability: space + action + dialogue
  const adaptationUsability = totalWindows > 0
    ? Math.min(1, (spaceCount + actionCount + dialogueCount) / (totalWindows * 4))
    : 0;

  let score = (writingCompleteness + adaptationUsability) / 2;

  if (type === 'character' || type === 'event') {
    const coverage = chapterIndices.length / Math.max(1, chapters.length);
    const presenceValue =
      Math.min(1, Math.log1p(totalCount) / Math.log1p(type === 'character' ? 200 : 20)) * 0.6 +
      Math.min(1, coverage / (type === 'character' ? 0.18 : 0.08)) * 0.4;
    score = Math.max(score, Math.min(1, presenceValue));
  }

  return { writingCompleteness, adaptationUsability, score };
}

// ─── Threshold Mapping ───

/**
 * Map raw pillar score (0-1) to story score contribution (0/1/2).
 * The medium/high thresholds are intentionally conservative so common,
 * single-mention entities do not outrank actual narrative assets.
 */
function mapPillarToScore(raw: number): number {
  if (raw >= 0.75) return 2;
  if (raw >= 0.5) return 1;
  return 0;
}

const STORY_SCORE_LOOKUP = [0, 0.17, 0.33, 0.5, 0.67, 0.83, 1] as const;

/**
 * Handover formula step: pillar sum (0-6) is mapped to normalized storyScore.
 */
export function mapStoryScoreToValue(storyScore: number): number {
  const index = Math.max(0, Math.min(6, Math.round(storyScore)));
  return STORY_SCORE_LOOKUP[index];
}

export function calcFinalImportance(
  storyScore: number,
  productionValue: number,
  options: ImportanceOptions = {}
): number {
  const { storyWeight = 0.7, prodWeight = 0.3 } = options;
  const storyValue = mapStoryScoreToValue(storyScore);
  return storyWeight * storyValue + prodWeight * productionValue;
}

/**
 * Map storyScore (0-6) to tier classification.
 */
function mapToTier(storyScore: number): 'core' | 'supporting' | 'candidate' | 'archived' {
  if (storyScore >= 5) return 'core';
  if (storyScore >= 3) return 'supporting';
  if (storyScore >= 1) return 'candidate';
  return 'archived';
}

/**
 * Map importance and production to quadrant classification.
 */
function mapToQuadrant(
  importance: number,
  production: number
): 'core' | 'supporting' | 'candidate' | 'archived' {
  const highImportance = importance >= 0.5;
  const highProduction = production >= 0.5;

  if (highImportance && highProduction) return 'core';
  if (highImportance && !highProduction) return 'supporting';
  if (!highImportance && highProduction) return 'candidate';
  return 'archived';
}

// ─── Main Function ───

export interface ImportanceOptions {
  /** Weight for storyScore in final formula (default: 0.7) */
  storyWeight?: number;
  /** Weight for productionValue in final formula (default: 0.3) */
  prodWeight?: number;
}

/**
 * Calculate importance scores for all entities.
 *
 * @param entities - filtered entity mentions
 * @param chapters - all chapters
 * @param options - weight configuration
 */
export function calcImportance(
  entities: Map<EntityType, EntityMention[]>,
  chapters: ScanChapter[],
  options: ImportanceOptions = {}
): Map<EntityType, EntityImportance[]> {
  const { storyWeight = 0.7, prodWeight = 0.3 } = options;
  const result = new Map<EntityType, EntityImportance[]>();

  // Collect all entity texts for irreplaceability calculation
  const allTexts: string[] = [];
  for (const mentions of entities.values()) {
    for (const m of mentions) {
      if (!allTexts.includes(m.text)) allTexts.push(m.text);
    }
  }

  // Collect all mention counts for percentile ranking
  const allMentionCounts: number[] = [];
  for (const mentions of entities.values()) {
    // Group by text to get counts
    const countMap = new Map<string, number>();
    for (const m of mentions) {
      countMap.set(m.text, (countMap.get(m.text) || 0) + (m.totalCount || 1));
    }
    allMentionCounts.push(...countMap.values());
  }

  for (const [type, mentions] of entities) {
    // Group by text
    const grouped = new Map<string, EntityMention[]>();
    for (const m of mentions) {
      if (!grouped.has(m.text)) grouped.set(m.text, []);
      grouped.get(m.text)!.push(m);
    }

    const importances: EntityImportance[] = [];

    for (const [text, group] of grouped) {
      // Use totalCount and allChapters if available (from confidence filter)
      const totalCount = group[0]?.totalCount || group.length;
      const allChapters = group[0]?.allChapters || [...new Set(group.map(m => m.chapterIndex))];
      const aliases = [...new Set(group.flatMap((m) => m.aliases || []))].filter(Boolean);

      // Calculate three pillars (each returns 0-1)
      const behaviorDrive = calcBehaviorDrive(group, chapters, allMentionCounts, type);
      const irreplaceability = calcIrreplaceability(text, allTexts);
      const infoUniqueness = calcInfoUniqueness(group, chapters);
      const stateTransition = calcStateTransition(group, chapters);

      // Map to pillar scores (0-2 each)
      // 因果必要性 = average of behaviorDrive and irreplaceability (both 0-1)
      const causalRaw = (behaviorDrive + irreplaceability) / 2;
      const pillars: PillarScores = {
        causalNecessity: mapPillarToScore(causalRaw),
        informationUniqueness: mapPillarToScore(infoUniqueness),
        stateTransition: mapPillarToScore(stateTransition),
      };

      // storyScore = sum of pillars (0-6)
      const storyScore = pillars.causalNecessity + pillars.informationUniqueness + pillars.stateTransition;
      const storyValue = mapStoryScoreToValue(storyScore);

      // Production value
      const production = calcProductionValue(group, chapters, type);

      // Final importance from the handover formula:
      // Importance = storyWeight × storyValue + prodWeight × productionValue
      const importance = calcFinalImportance(storyScore, production.score, { storyWeight, prodWeight });

      // Classification
      const tier = mapToTier(storyScore);
      const quadrant = mapToQuadrant(importance, production.score);

      importances.push({
        text,
        aliases: aliases.length > 0 ? aliases : undefined,
        type,
        pillars,
        storyScore,
        storyValue,
        production,
        importance,
        tier,
        quadrant,
        mentionCount: totalCount,
        chapters: allChapters,
      });
    }

    // Sort by importance descending
    importances.sort((a, b) =>
      (b.importance - a.importance) ||
      (b.storyScore - a.storyScore) ||
      (b.mentionCount - a.mentionCount) ||
      a.text.localeCompare(b.text, 'zh-Hans-CN')
    );

    result.set(type, importances);
  }

  return result;
}
