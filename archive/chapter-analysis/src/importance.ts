/** Minimal chapter interface for analysis (avoids circular dep on @novel-agent/import) */
export interface ChapterLike {
  title?: string;
  content: string;
  wordCount: number;
  lineType: 'main' | 'sub';
  number?: number;
  index: number;
}

export interface ImportanceScore {
  /** Final composite score 0-1 */
  score: number;
  /** Contribution breakdown */
  factors: {
    lineTypeWeight: number;
    protagonistDensity: number;
    lengthFactor: number;
  };
}

export interface ImportanceOptions {
  protagonistNames?: string[];
  /** Average chapter word count for length normalization (auto-computed if 0) */
  avgWordCount?: number;
}

/**
 * Compute importance score for a single chapter.
 *
 * Formula:
 *   score = lineWeight × 0.35 + density × 0.40 + length × 0.25
 *
 * - lineWeight: main=1.0, sub=0.3
 * - density: min(1.0, mentions / (wordCount / 500))
 * - length: sigmoid(wordCount / avgWordCount)
 */
export function scoreChapterImportance(
  node: ChapterLike,
  context: { avgWordCount: number; protagonistNames: string[] }
): ImportanceScore {
  // 1. Line type weight
  const lineTypeWeight = node.lineType === 'main' ? 1.0 : 0.3;

  // 2. Protagonist mention density
  let mentions = 0;
  for (const name of context.protagonistNames) {
    const hasCJK = /[一-鿿]/.test(name);
    const boundary = hasCJK ? '' : '\\b';
    const re = new RegExp(`${boundary}${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}${boundary}`, 'gi');
    const matches = node.content.match(re);
    if (matches) mentions += matches.length;
  }
  // Density: mentions per 500 chars, capped at 1.0
  const density = Math.min(1.0, mentions / Math.max(1, node.wordCount / 500));

  // 3. Length factor — normalized against average
  const avgWc = Math.max(1, context.avgWordCount);
  const lengthFactor = Math.min(1.0, 0.3 + 0.7 * (node.wordCount / avgWc));

  // Composite score
  const score = clamp(
    lineTypeWeight * 0.35 + density * 0.40 + lengthFactor * 0.25,
    0, 1
  );

  return { score, factors: { lineTypeWeight, protagonistDensity: density, lengthFactor } };
}

/**
 * Score all chapters in a flat list. Mutates nodes in place
 * (adds .importance field) and returns ranked list.
 */
export function scoreAllChapters(
  nodes: ChapterLike[],
  options: ImportanceOptions = {}
): ChapterLike[] {
  if (nodes.length === 0) return nodes;

  const protagonistNames = options.protagonistNames || [];

  const avgWordCount = options.avgWordCount
    || nodes.reduce((s, n) => s + n.wordCount, 0) / nodes.length;

  for (const node of nodes) {
    const imp = scoreChapterImportance(node, { avgWordCount, protagonistNames });
    // Attach score to node (extend with importance)
    (node as ChapterLike & { importance?: ImportanceScore }).importance = imp;
  }

  // Return sorted by importance descending
  return [...nodes].sort(
    (a, b) =>
      ((b as ChapterLike & { importance?: ImportanceScore }).importance?.score ?? 0) -
      ((a as ChapterLike & { importance?: ImportanceScore }).importance?.score ?? 0)
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
