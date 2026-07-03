import { preprocess, type PreprocessReport } from '@novel-agent/preprocess';
import { splitChapters, splitChaptersStructured, type ChapterInfo, type StructuredResult } from './chapter-splitter.js';
import { type ParseResult } from './txt.js';
import { prescanEntities, type PrescanResult } from '@novel-agent/entity-prescan';

export { type ChapterInfo, type ChapterNode, type LineType, type StructuredResult } from './chapter-splitter.js';
export { type FilterReport as SanitizeReport, type SuspectLine, type NoiseCategory } from '@novel-agent/preprocess';
export { type PrescanResult } from '@novel-agent/entity-prescan';

export interface ParseOptions {
  /** Run text normalization (default: true) */
  normalize?: boolean;
  /** Remove noise lines from text before parsing (default: true) */
  cleanNoise?: boolean;
  /** Noise removal mode: conservative (>=0.8 confidence) or aggressive (default: conservative) */
  noiseMode?: 'conservative' | 'aggressive';
  /** Manual encoding override (auto-detect if not specified) */
  encoding?: 'utf-8' | 'gb18030';
  /** Protagonist names for main/sub line classification */
  protagonistNames?: string[];
  /** Book ID — used for entity prescan output directory */
  bookId?: string;
  /** Output directory root for prescan files (default: 'output') */
  outputDir?: string;
  /** Exact directory for prescan files, used when prescan is an intermediate pipeline artifact */
  prescanOutputPath?: string;
  /** Whether to run LLM completion after regex prescan (default: true) */
  useLLM?: boolean;
  /** Chapters per LLM prescan batch (default: 10) */
  prescanBatchSize?: number;
  /** Weight for storyScore in importance formula (default: 0.7) */
  storyWeight?: number;
  /** Weight for productionValue in importance formula (default: 0.3) */
  prodWeight?: number;
}

export interface EnhancedParseResult extends ParseResult {
  /** Preprocessing report (normalize + filter) */
  preprocessReport?: PreprocessReport;
  /** Structured chapter tree (hierarchy + line type) */
  structure?: StructuredResult;
  /** Entity prescan results (character/location/item/event) */
  prescanResult?: PrescanResult;
  /** Which chapter-splitting mode was used */
  chapterMode: string;
  /** Whether fallback (fixed chunking) was used */
  isFallback: boolean;
  /** Chapter info with word counts (enhanced data, flat list) */
  chapters: Array<{
    index: number;
    title?: string;
    content: string;
    wordCount: number;
  }>;
}

export interface ChapterOutlineResult {
  title: string;
  chapterMode: string;
  isFallback: boolean;
  removedNoiseLines: number;
  /** 疑似噪声行明细（保守模式实际移除 confidence >= 0.8 的行），最多 200 条 */
  suspectLines: Array<{ lineNum: number; content: string; category: string; confidence: number; removed: boolean }>;
  chapters: Array<{ index: number; title?: string; wordCount: number }>;
}

/**
 * 轻量章节大纲：只走真实管线的前两步（预处理 + 结构化切章），
 * 不做实体预扫描、不写任何文件。供前端章节视图按需解析。
 */
export function parseChapterOutline(content: string, filename: string): ChapterOutlineResult {
  const title = filename.replace(/\.txt$/i, '');
  const { text, report } = preprocess(content.trim(), {});
  const structure = splitChaptersStructured(text, {});
  return {
    title,
    chapterMode: structure.matchedMode,
    isFallback: structure.isFallback,
    removedNoiseLines: report.filter?.removedCount ?? 0,
    suspectLines: (report.filter?.suspectLines ?? []).slice(0, 200).map((l) => ({
      lineNum: l.lineNum,
      content: l.content,
      category: l.category,
      confidence: l.confidence,
      removed: l.confidence >= 0.8,
    })),
    chapters: structure.flatList.map((ch) => ({
      index: ch.index,
      title: ch.title,
      wordCount: ch.wordCount,
    })),
  };
}

/**
 * Enhanced TXT parser with full preprocessing pipeline.
 *
 * Pipeline (serial):
 * 1. Preprocessing: normalize (format unification) + filter (noise removal)
 * 2. Chapter splitting → structured tree (hierarchy + main/sub classification)
 * 3. Entity pre-scanning (time/character/location/item/event) → output files
 */
export async function parseTxtEnhanced(
  content: string,
  filename: string,
  options: ParseOptions = {}
): Promise<EnhancedParseResult> {
  const {
    normalize = true,
    cleanNoise = true,
    noiseMode = 'conservative',
    protagonistNames,
    bookId,
    outputDir = 'output',
    prescanOutputPath,
    useLLM = true,
    prescanBatchSize = 10,
  } = options;

  const title = filename.replace(/\.txt$/i, '');
  let text = content.trim();

  // Step 1: Preprocessing (normalize + filter)
  const { text: preprocessed, report: preprocessReport } = preprocess(text, {
    skipNormalize: !normalize,
    skipFilter: !cleanNoise,
    noiseMode,
  });
  text = preprocessed;

  // Step 2: Structured chapter splitting (hierarchy + line classification)
  const structure = splitChaptersStructured(text, { protagonistNames });
  const chapters = structure.flatList.map((ch) => ({
    index: ch.index,
    title: ch.title,
    content: ch.content,
    wordCount: ch.wordCount,
  }));

  // Step 3: Entity pre-scanning (regex + LLM → output/{bookId}/)
  let prescanResult: PrescanResult | undefined;
  if (bookId && chapters.length > 0) {
    const scanChapters = chapters.map((ch) => ({
      index: ch.index,
      title: ch.title,
      content: ch.content,
    }));

    try {
      prescanResult = await prescanEntities(scanChapters, {
        bookId,
        outputDir,
        outputPath: prescanOutputPath,
        useLLM,
        batchSize: prescanBatchSize,
        storyWeight: options.storyWeight,
        prodWeight: options.prodWeight,
      });
    } catch (error) {
      console.warn(`[import] Entity prescan failed: ${error instanceof Error ? error.message : error}`);
    }
  }

  // Build compatible ParseResult structure
  const parseResult: ParseResult = {
    title,
    chapters: chapters.map((ch) => ({
      index: ch.index,
      title: ch.title,
      content: ch.content,
    })),
    fullText: text,
  };

  return {
    ...parseResult,
    chapters,
    preprocessReport,
    structure,
    prescanResult,
    chapterMode: structure.matchedMode,
    isFallback: structure.isFallback,
  };
}
