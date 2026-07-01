export interface ParsedChapter {
  index: number;
  title?: string;
  content: string;
}

export interface ParseResult {
  title: string;
  chapters: ParsedChapter[];
  fullText: string;
}

/**
 * Parse TXT content into chapters
 * - Split by "---" chapter markers
 * - If no markers found, split by ~2000 characters
 */
export function parseTxt(content: string, filename: string): ParseResult {
  const title = filename.replace(/\.txt$/i, '');
  const fullText = content.trim();

  // Guard against extremely large files
  const MAX_PARSE_LENGTH = 5 * 1024 * 1024; // 5MB of text ≈ 1.5M Chinese characters
  if (fullText.length > MAX_PARSE_LENGTH) {
    throw new Error(
      `文件内容过长（${(fullText.length / 1024 / 1024).toFixed(1)}MB字符），超出解析上限 5MB 字符。` +
      `建议：① 拆分为多卷上传 ② 或去除非正文内容（广告、作者的话等）后重试`
    );
  }

  // Try to split by --- markers
  const sections = fullText.split(/^---$/m).filter(s => s.trim());

  if (sections.length > 1) {
    const chapters: ParsedChapter[] = sections.map((section, index) => {
      const lines = section.trim().split('\n');
      // First line might be chapter title
      const firstLine = lines[0].trim();
      const isTitle = firstLine.length > 0 && firstLine.length < 100 && !firstLine.includes('\n');

      if (isTitle && lines.length > 1) {
        return {
          index,
          title: firstLine,
          content: lines.slice(1).join('\n').trim(),
        };
      }
      return {
        index,
        content: section.trim(),
      };
    });

    return { title, chapters, fullText };
  }

  // Fallback: split by ~2000 characters
  const chunkSize = 2000;
  const chapters: ParsedChapter[] = [];
  for (let i = 0; i < fullText.length; i += chunkSize) {
    chapters.push({
      index: chapters.length,
      content: fullText.slice(i, i + chunkSize),
    });
  }

  return { title, chapters, fullText };
}

// Re-export enhanced parsing from pipeline
export { parseTxtEnhanced, type ParseOptions, type EnhancedParseResult } from './pipeline.js';
export { detectNoise, cleanText, type SanitizeReport, type SuspectLine, type NoiseCategory } from './sanitizer.js';
export { preprocess, normalize, type PreprocessReport, type PreprocessOptions } from '@novel-agent/preprocess';
export { splitChapters, splitChaptersStructured, type ChapterInfo, type ChapterNode, type LineType, type StructuredResult } from './chapter-splitter.js';
export { decodeText, detectEncoding } from './encoding.js';
