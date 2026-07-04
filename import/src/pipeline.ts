import { preprocess, normalize, detectNoise, type PreprocessReport, type FilterReport, type SuspectLine, type NoiseCategory } from '@novel-agent/preprocess';
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
  /** 疑似噪声行总数（未截断），用于前端显示"共 N 条" */
  suspectLinesTotal: number;
  /** 各噪声类别的真实总数（未截断），用于前端分类小计 */
  byCategory: Record<string, number>;
  /** 疑似噪声行明细（保守模式实际移除 confidence >= 0.8 的行），最多 200 条 */
  suspectLines: Array<{ lineNum: number; content: string; category: string; confidence: number; removed: boolean; restored?: boolean }>;
  chapters: Array<{ index: number; title?: string; wordCount: number }>;
}

/**
 * 轻量章节大纲：只走真实管线的前两步（预处理 + 结构化切章），
 * 不做实体预扫描、不写任何文件。供前端章节视图按需解析。
 * @param keepLines 人工「找回」的行号集合（规范化后 1-based），这些行保留不删。
 */
export function parseChapterOutline(content: string, filename: string, keepLines?: Set<number>): ChapterOutlineResult {
  const title = filename.replace(/\.txt$/i, '');
  const { text, report } = preprocess(content.trim(), keepLines ? { keepLines } : {});
  const structure = splitChaptersStructured(text, {});
  const allSuspect = report.filter?.suspectLines ?? [];
  return {
    title,
    chapterMode: structure.matchedMode,
    isFallback: structure.isFallback,
    removedNoiseLines: report.filter?.removedCount ?? 0,
    suspectLinesTotal: allSuspect.length,
    byCategory: { ...(report.filter?.byCategory ?? {}) },
    suspectLines: allSuspect.slice(0, 200).map((l) => {
      const wouldRemove = l.confidence >= 0.8;
      const restored = wouldRemove && keepLines?.has(l.lineNum) === true;
      return {
        lineNum: l.lineNum,
        content: l.content,
        category: l.category,
        confidence: l.confidence,
        removed: wouldRemove && !restored,
        restored,
      };
    }),
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

/** 单章清洗后内容（含被删/被找回的噪声行标记，供前端高亮阅读）。 */
export interface ChapterContentResult {
  chapterIndex: number;
  title?: string;
  /** 该章正文（规范化后、未清洗，即含被标记噪声行的完整文本） */
  content: string;
  /** 该章第 1 行对应的全文 1-based 行号（用于把章内行号映射到 noiseLines.lineNum） */
  startLineNum: number;
  /** 该章涉及的噪声行明细，lineNum 为规范化后文本 1-based 行号 */
  noiseLines: Array<{ lineNum: number; content: string; category: string; confidence: number; removed: boolean; restored?: boolean }>;
}

/**
 * 读取单章清洗后的可读内容，用于章节页「正文阅读 + 噪声高亮 + 找回」。
 *
 * 实现要点：
 * - 在规范化后、**未清洗**的文本上切章（行号与 detectNoise 返回的 lineNum 对齐，可精确高亮）。
 * - 章节正文 = 该章行号范围内的所有行（含噪声行，前端据此高亮）。
 * - noiseLines 只返回落在该章行号范围内的 suspect 行。
 * @param chapterIndex 0-based 章节序号（与大纲 chapters[].index 对齐）
 * @param keepLines 人工「找回」的行号集合
 */
export function getChapterCleanedContent(
  content: string,
  filename: string,
  chapterIndex: number,
  keepLines?: Set<number>,
): ChapterContentResult | null {
  // 仅规范化、不清洗：行号与 detectNoise 一致
  const norm = normalize(content.trim());
  const normalizedText = norm.text;

  const report = detectNoise(normalizedText);
  const allSuspect = report.suspectLines;

  // 在规范化后未清洗文本上切章，拿到每章行号范围
  const structure = splitChapters(normalizedText);
  const chapters = structure.chapters;
  if (chapterIndex < 0 || chapterIndex >= chapters.length) return null;

  // splitChapters 用 lines.slice 切，需要重建每章的行号范围。
  // 重新遍历 lines，按章节 content 匹配定位起止行号。
  const lines = normalizedText.split('\n');
  const target = chapters[chapterIndex];
  // 用 content 的首行匹配定位起始行号（与 chapter-splitter 内部逻辑一致）
  const firstLine = target.content.split('\n')[0];
  let startLine = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === firstLine || lines[i].trim() === firstLine.trim()) {
      startLine = i;
      break;
    }
  }
  // 下一章的起始行号即本章结束
  let endLine = lines.length;
  if (chapterIndex + 1 < chapters.length) {
    const nextFirst = chapters[chapterIndex + 1].content.split('\n')[0];
    for (let i = startLine + 1; i < lines.length; i++) {
      if (lines[i] === nextFirst || lines[i].trim() === nextFirst.trim()) {
        endLine = i;
        break;
      }
    }
  }

  // 该章行号范围 [startLine+1, endLine]（1-based）
  const noiseLines = allSuspect
    .filter((s) => s.lineNum >= startLine + 1 && s.lineNum <= endLine)
    .map((s) => {
      const wouldRemove = s.confidence >= 0.8;
      const restored = wouldRemove && keepLines?.has(s.lineNum) === true;
      return {
        lineNum: s.lineNum,
        content: s.content,
        category: s.category,
        confidence: s.confidence,
        removed: wouldRemove && !restored,
        restored,
      };
    });

  return {
    chapterIndex,
    title: target.title,
    content: target.content,
    startLineNum: startLine + 1,
    noiseLines,
  };
}
