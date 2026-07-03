/**
 * Lightweight Chinese text vectorization using character n-grams.
 * Produces sparse vectors suitable for cosine-similarity semantic retrieval.
 */

export type SparseVector = Map<string, number>;

export interface VectorizeOptions {
  /** Use bigrams (2-char sequences), default: true */
  bigrams?: boolean;
  /** Use trigrams (3-char sequences), default: true */
  trigrams?: boolean;
  /** Include single characters, default: false (too noisy for Chinese) */
  unigrams?: boolean;
  /** Min n-gram frequency to include in vector, default: 1 */
  minFreq?: number;
}

/**
 * Extract character n-grams from Chinese text.
 * Only CJK characters are used; punctuation and whitespace are skipped.
 */
function* extractNGrams(text: string, n: number): Generator<string> {
  const chars: string[] = [];
  for (const c of text) {
    if (/[一-鿿]/.test(c)) chars.push(c);
  }
  for (let i = 0; i <= chars.length - n; i++) {
    yield chars.slice(i, i + n).join('');
  }
}

/**
 * Count term frequencies from a generator.
 */
function countFreqs(gen: Generator<string>, minFreq: number): Map<string, number> {
  const map = new Map<string, number>();
  for (const term of gen) {
    map.set(term, (map.get(term) || 0) + 1);
  }
  if (minFreq > 1) {
    for (const [k, v] of map) {
      if (v < minFreq) map.delete(k);
    }
  }
  return map;
}

/**
 * Compute L2 norm of a sparse vector.
 */
export function vectorNorm(vec: SparseVector): number {
  let sum = 0;
  for (const v of vec.values()) sum += v * v;
  return Math.sqrt(sum);
}

/**
 * Normalize a sparse vector to unit length (L2).
 */
export function normalizeVector(vec: SparseVector): SparseVector {
  const norm = vectorNorm(vec);
  if (norm === 0) return vec;
  const out = new Map<string, number>();
  for (const [k, v] of vec) out.set(k, v / norm);
  return out;
}

/**
 * Cosine similarity between two sparse vectors.
 */
export function cosineSimilarity(a: SparseVector, b: SparseVector): number {
  let dot = 0;
  for (const [k, va] of a) {
    const vb = b.get(k);
    if (vb !== undefined) dot += va * vb;
  }
  const normA = vectorNorm(a);
  const normB = vectorNorm(b);
  if (normA === 0 || normB === 0) return 0;
  return dot / (normA * normB);
}

/**
 * Convert text to a normalized sparse TF vector.
 *
 * Uses character bigrams + trigrams of CJK characters.
 * The resulting vector can be compared with cosineSimilarity()
 * for semantic retrieval — chapters with similar vocabulary
 * will have higher similarity scores.
 */
export function textToVector(
  text: string,
  options: VectorizeOptions = {}
): SparseVector {
  const { bigrams = true, trigrams = true, unigrams = false, minFreq = 1 } = options;

  const result = new Map<string, number>();

  if (unigrams) {
    for (const [k, v] of countFreqs(extractNGrams(text, 1), minFreq)) {
      result.set(k, v);
    }
  }
  if (bigrams) {
    for (const [k, v] of countFreqs(extractNGrams(text, 2), minFreq)) {
      result.set(k, (result.get(k) || 0) + v);
    }
  }
  if (trigrams) {
    for (const [k, v] of countFreqs(extractNGrams(text, 3), minFreq)) {
      result.set(k, (result.get(k) || 0) + v);
    }
  }

  return normalizeVector(result);
}
