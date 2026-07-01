/**
 * Indexed alias entry — stored internally for matching/merging,
 * NOT exposed to the frontend.
 */
export interface AliasIndexEntry {
  /** Alias text (e.g. "萧炎哥") */
  alias: string;
  /** Which chapter indices this alias appears in */
  chapterIndices: number[];
  /** Total mention count of this alias across all chapters */
  count: number;
}

/** A single entity mention found in the text */
export interface EntityMention {
  /** The entity text (e.g. "长安城", "翌日", "青锋剑") */
  text: string;
  /** Chapter index where found */
  chapterIndex: number;
  /** Character offset within the chapter content */
  position: number;
  /** Detection source */
  source: 'regex' | 'llm';
  /** Confidence score 0-1 */
  confidence: number;
  /** Total mention count across all chapters (preserved after dedup) */
  totalCount?: number;
  /** All chapter indices where this entity appears */
  allChapters?: number[];
  /**
   * Canonical character aliases merged into this mention.
   * NOTE: For frontend display only — does NOT contain chapter index info.
   * Use `aliasIndex` for internal matching/merging.
   */
  aliases?: string[];
  /**
   * Internal alias index with chapter-level detail.
   * Used by the merge layer for precise alias→character matching.
   * NOT serialized to frontend-facing files.
   */
  aliasIndex?: AliasIndexEntry[];
}

/** Entity type keys */
export type EntityType = 'character' | 'location' | 'item' | 'event';

/** Per-type extraction stats */
export interface TypeStats {
  regexCount: number;
  llmCount: number;
  afterDedup: number;
}

/** Full prescan result containing all four entity types */
export interface PrescanResult {
  character: EntityMention[];
  location: EntityMention[];
  item: EntityMention[];
  event: EntityMention[];
  stats: {
    character: TypeStats;
    location: TypeStats;
    item: TypeStats;
    event: TypeStats;
    durationMs: number;
  };
}

/** Options for the prescan pipeline */
export interface PrescanOptions {
  /** Book identifier, used for output directory */
  bookId: string;
  /** Output directory root (default: 'output') */
  outputDir?: string;
  /** Exact output directory for prescan files. Overrides outputDir/bookId when set. */
  outputPath?: string;
  /** Whether to run LLM completion after regex (default: true) */
  useLLM?: boolean;
  /** Number of chapters per LLM batch (default: 10) */
  batchSize?: number;
  /** Weight for storyScore in importance formula (default: 0.7) */
  storyWeight?: number;
  /** Weight for productionValue in importance formula (default: 0.3) */
  prodWeight?: number;
}

/** Minimal chapter input for scanning */
export interface ScanChapter {
  index: number;
  title?: string;
  content: string;
}
