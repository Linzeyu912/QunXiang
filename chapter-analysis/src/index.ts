export { scoreChapterImportance, scoreAllChapters } from './importance.js';
export type { ImportanceScore, ImportanceOptions, ChapterLike } from './importance.js';
export { textToVector, normalizeVector, cosineSimilarity, vectorNorm } from './vectorize.js';
export type { SparseVector, VectorizeOptions } from './vectorize.js';

import { scoreChapterImportance, type ImportanceScore, type ChapterLike } from './importance.js';
import { textToVector, type SparseVector } from './vectorize.js';

/** Extended chapter node with analysis results */
export interface AnalyzedChapter extends ChapterLike {
  importance: ImportanceScore;
  vector: SparseVector;
}

export interface AnalysisOptions {
  protagonistNames?: string[];
  avgWordCount?: number;
}

/**
 * Run full chapter analysis: importance scoring + vectorization.
 * Returns each chapter with `.importance` and `.vector` attached, sorted by importance.
 */
export function analyzeChapters(
  nodes: ChapterLike[],
  options: AnalysisOptions = {}
): AnalyzedChapter[] {
  const protagonistNames = options.protagonistNames || [];
  const avgWordCount = options.avgWordCount
    || nodes.reduce((s, n) => s + n.wordCount, 0) / Math.max(1, nodes.length);

  const analyzed: AnalyzedChapter[] = [];

  for (const node of nodes) {
    const importance = scoreChapterImportance(node, { avgWordCount, protagonistNames });
    const vector = textToVector(node.content);
    analyzed.push({ ...node, importance, vector });
  }

  analyzed.sort((a, b) => b.importance.score - a.importance.score);

  return analyzed;
}
