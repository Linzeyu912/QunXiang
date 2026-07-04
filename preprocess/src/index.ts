export { normalize } from './normalize.js';
export type { NormalizeReport } from './normalize.js';
export { detectNoise, cleanText } from './filter.js';
export type { FilterReport, SuspectLine, NoiseCategory } from './filter.js';

import { normalize } from './normalize.js';
import { detectNoise, cleanText } from './filter.js';

export interface PreprocessOptions {
  /** Noise removal mode: conservative (>=0.8 confidence) or aggressive (all) */
  noiseMode?: 'conservative' | 'aggressive';
  /** Skip normalization step (default: false) */
  skipNormalize?: boolean;
  /** Skip noise filtering step (default: false) */
  skipFilter?: boolean;
  /** 人工「找回」的行号集合（1-based，规范化后文本），这些行保留不删 */
  keepLines?: Set<number>;
}

export interface PreprocessReport {
  normalize: import('./normalize.js').NormalizeReport | null;
  filter: import('./filter.js').FilterReport | null;
}

/**
 * Full preprocessing pipeline:
 *   1. normalize  — format unification (newlines, fullwidth, whitespace)
 *   2. filter     — noise removal (ads, garbled text, non-body paragraphs)
 */
export function preprocess(
  text: string,
  options: PreprocessOptions = {}
): { text: string; report: PreprocessReport } {
  const { noiseMode = 'conservative', skipNormalize = false, skipFilter = false, keepLines } = options;

  let processed = text;
  let normalizeReport = null;
  let filterReport = null;

  if (!skipNormalize) {
    const normResult = normalize(processed);
    processed = normResult.text;
    normalizeReport = normResult.report;
  }

  if (!skipFilter) {
    filterReport = detectNoise(processed);
    processed = cleanText(processed, filterReport, noiseMode, keepLines);
  }

  return {
    text: processed,
    report: { normalize: normalizeReport, filter: filterReport },
  };
}
