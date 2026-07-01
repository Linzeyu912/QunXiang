export interface ChapterInfo {
  index: number;
  title?: string;
  content: string;
  wordCount: number;
}

export interface SplitResult {
  chapters: ChapterInfo[];
  matchedMode: 'chapter_zh' | 'chapter_en' | 'heuristic' | 'fixed';
  isFallback: boolean;
}

// ═══ New: structured chapter tree ═══

export type LineType = 'main' | 'sub';

/** Hierarchy level of a chapter node */
export type NodeLevel = 'volume' | 'chapter';

export interface ChapterNode {
  index: number;
  title?: string;
  content: string;
  wordCount: number;
  level: NodeLevel;
  /** Index of parent ChapterNode, undefined for root-level nodes */
  parentIndex?: number;
  /** Child nodes (chapters within a volume, etc.) */
  children: ChapterNode[];
  /** Main or sub plot line */
  lineType: LineType;
  /** Extracted numeric identifier, if any */
  number?: number;
}

export interface StructuredResult {
  /** Top-level nodes (volumes or chapters if no volumes detected) */
  rootChildren: ChapterNode[];
  /** Flat list of all nodes (depth-first), for iteration */
  flatList: ChapterNode[];
  /** Backward-compatible flat chapter list */
  chapters: ChapterInfo[];
  matchedMode: string;
  isFallback: boolean;
}

// Chinese number mapping
const CN_NUM_MAP: Record<string, number> = {
  '零': 0, '〇': 0, '一': 1, '二': 2, '三': 3, '四': 4,
  '五': 5, '六': 6, '七': 7, '八': 8, '九': 9,
  '十': 10, '百': 100, '千': 1000, '万': 10000,
};

/**
 * Convert Chinese numerals to number string
 */
function cnToNumber(cn: string): string {
  let result = 0;
  let temp = 0;
  let hasTen = false;

  for (let i = 0; i < cn.length; i++) {
    const char = cn[i];
    const val = CN_NUM_MAP[char];
    if (val === undefined) continue;

    if (val >= 10) {
      if (val >= 1000) {
        result += temp * val;
        temp = 0;
      } else if (val === 100) {
        hasTen = true;
        temp = temp === 0 ? 1 : temp * val;
      } else if (val === 10) {
        hasTen = true;
        temp = temp === 0 ? 1 : temp * val;
      }
    } else {
      temp += val;
    }
  }

  result += temp;

  // Handle 十 alone case
  if (hasTen && result === 0) result = 10;
  else if (hasTen && temp < 10) result += 10;

  return String(result);
}

/**
 * Extract chapter number from title
 */
function extractChapterNum(title: string): number | null {
  // 第X章 pattern
  const m = title.match(/第([零〇一二两三四五六七八九十百千万\d]+)章/);
  if (m) {
    const cn = m[1];
    if (/\d/.test(cn)) return parseInt(cn, 10);
    return parseInt(cnToNumber(cn), 10) || null;
  }

  // 番外X pattern
  const fanwai = title.match(/番外([零〇一二两三四五六七八九十百千万\d]+)/);
  if (fanwai) {
    const cn = fanwai[1];
    if (/\d/.test(cn)) return parseInt(cn, 10);
    return parseInt(cnToNumber(cn), 10) || null;
  }

  // 楔子/引子/序章 etc.
  const structural = title.match(/(?:楔子|引子|序[言章曲]|后记|尾声|完本感言)/);
  if (structural) return -1; // Special marker

  return null;
}

// Pattern 1: Chinese chapter titles
const CHAPTER_ZH_RE = /^([\s]*)(?:第[零〇一二两三四五六七八九十百千万\d]+部.+?)?(?:第[零〇一二两三四五六七八九十百千万\d]+[章]|番外[零〇一二两三四五六七八九十百千万\d篇]*|楔子|引子|序[言章曲]|后记|尾声|完本感言)[\s：:，,]*(.*)$/im;

// Pattern 2: English chapter
const CHAPTER_EN_RE = /^[\s]*(?:chapter|CHAPTER)[\s.:\-]*(?:\d+|[IVXLC]+)(.*)$/im;

// Pattern 3: Heuristic - line starts with number or special markers
const HEURISTIC_RE = /^[\s]*[\[【【第]?\d+[\]】\s.\-_:：]/im;

// Pattern 4: Decorators separators
const SEPARATOR_RE = /^[\s]*[-=*_]{5,}[\s]*$/;

/**
 * Find chapter boundaries in text
 */
function findChapterBoundaries(text: string): number[] {
  const boundaries: number[] = [0];
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) continue;

    // Skip decoration lines
    if (SEPARATOR_RE.test(trimmed)) continue;

    // Check Chinese chapter pattern
    if (CHAPTER_ZH_RE.test(line)) {
      if (boundaries[boundaries.length - 1] !== i) {
        boundaries.push(i);
        CHAPTER_ZH_RE.lastIndex = 0;
      }
      continue;
    }
    CHAPTER_ZH_RE.lastIndex = 0;

    // Check English chapter pattern
    if (CHAPTER_EN_RE.test(line)) {
      if (boundaries[boundaries.length - 1] !== i) {
        boundaries.push(i);
        CHAPTER_EN_RE.lastIndex = 0;
      }
      continue;
    }
    CHAPTER_EN_RE.lastIndex = 0;

    // Check heuristic pattern
    if (HEURISTIC_RE.test(line)) {
      const nextLine = lines[i + 1]?.trim();
      if (nextLine && nextLine.length > 10) {
        if (boundaries[boundaries.length - 1] !== i) {
          boundaries.push(i);
          HEURISTIC_RE.lastIndex = 0;
        }
      }
      continue;
    }
    HEURISTIC_RE.lastIndex = 0;
  }

  return boundaries;
}

/**
 * Extract title from chapter line
 */
function extractTitle(line: string): string | undefined {
  const trimmed = line.trim();
  if (!trimmed) return undefined;

  // Chinese chapter pattern
  let m = trimmed.match(/^(?:第[零〇一二两三四五六七八九十百千万\d]+部.+?)?(?:第[零〇一二两三四五六七八九十百千万\d]+[章]|番外[零〇一二两三四五六七八九十百千万\d篇]*|楔子|引子|序[言章曲]|后记|尾声|完本感言)[\s：:，,]*(.*)$/im);
  if (m && m[1]) return m[1].trim();
  if (m) return trimmed;

  // English pattern
  m = trimmed.match(/^(?:chapter|CHAPTER)[\s.:\-]*(?:\d+|[IVXLC]+)(.*)$/im);
  if (m && m[1]) return m[1].trim();
  if (m) return trimmed;

  // Heuristic - clean up number prefix
  m = trimmed.match(/^[\[【第]?\d+[\]】\s.\-_:：]*(.*)$/);
  if (m && m[1]) return m[1].trim();

  return trimmed.length < 100 ? trimmed : undefined;
}

/**
 * Split text into chapters using multiple patterns
 */
export function splitChapters(text: string): SplitResult {
  const boundaries = findChapterBoundaries(text);
  const lines = text.split('\n');

  // If we found chapter markers, use them
  if (boundaries.length > 1) {
    const chapters: ChapterInfo[] = [];

    for (let i = 0; i < boundaries.length; i++) {
      const startLine = boundaries[i];
      const endLine = i < boundaries.length - 1 ? boundaries[i + 1] : lines.length;
      const chapterLines = lines.slice(startLine, endLine);

      if (chapterLines.length === 0) continue;

      const content = chapterLines.join('\n').trim();
      if (!content) continue;

      const firstLine = chapterLines[0];
      const title = extractTitle(firstLine);

      chapters.push({
        index: chapters.length,
        title,
        content,
        wordCount: content.replace(/\s/g, '').length,
      });
    }

    if (chapters.length > 0) {
      return {
        chapters,
        matchedMode: 'chapter_zh',
        isFallback: false,
      };
    }
  }

  // Try English chapters
  const enBoundaries: number[] = [0];
  for (let i = 0; i < lines.length; i++) {
    if (CHAPTER_EN_RE.test(lines[i])) {
      if (enBoundaries[enBoundaries.length - 1] !== i) {
        enBoundaries.push(i);
        CHAPTER_EN_RE.lastIndex = 0;
      }
    }
    CHAPTER_EN_RE.lastIndex = 0;
  }

  if (enBoundaries.length > 1) {
    const chapters: ChapterInfo[] = [];
    for (let i = 0; i < enBoundaries.length; i++) {
      const startLine = enBoundaries[i];
      const endLine = i < enBoundaries.length - 1 ? enBoundaries[i + 1] : lines.length;
      const chapterLines = lines.slice(startLine, endLine);
      const content = chapterLines.join('\n').trim();
      if (!content) continue;

      chapters.push({
        index: chapters.length,
        title: extractTitle(chapterLines[0]),
        content,
        wordCount: content.replace(/\s/g, '').length,
      });
    }

    if (chapters.length > 0) {
      return { chapters, matchedMode: 'chapter_en', isFallback: false };
    }
  }

  // Fallback: fixed-size chunking
  const chunkSize = 3000;
  const chapters: ChapterInfo[] = [];
  let offset = 0;

  while (offset < text.length) {
    const chunk = text.slice(offset, offset + chunkSize);
    chapters.push({
      index: chapters.length,
      content: chunk.trim(),
      wordCount: chunk.replace(/\s/g, '').length,
    });
    offset += chunkSize;
  }

  return {
    chapters,
    matchedMode: 'fixed',
    isFallback: true,
  };
}

// ═══ Volume detection ═══

const VOLUME_RE = /^(?:第[零〇一二两三四五六七八九十百千万\d]+(?:卷|部|集|篇|季|辑))[\s：:，,]*(.*)$/im;

function detectVolume(line: string): { number: number; title?: string } | null {
  const trimmed = line.trim();
  const m = trimmed.match(VOLUME_RE);
  if (!m) return null;

  const numStr = m[0].match(/第([零〇一二两三四五六七八九十百千万\d]+)(?:卷|部|集|篇|季|辑)/);
  if (!numStr) return null;

  const cn = numStr[1];
  let num: number;
  if (/\d/.test(cn)) num = parseInt(cn, 10);
  else num = parseInt(cnToNumber(cn), 10);
  if (isNaN(num)) return null;

  return { number: num, title: m[1]?.trim() || undefined };
}

// ═══ Main/Sub line classification ═══

function classifyLineType(
  content: string,
  title: string | undefined,
  protagonistNames: string[],
  minMentions: number,
): LineType {
  // Extra chapters, prologue, epilogue → always sub
  if (title) {
    const subMarkers = /^(?:番外|楔子|引子|序[言章曲]|后记|尾声|完本感言)/;
    if (subMarkers.test(title)) return 'sub';
  }

  // Protagonist presence check
  if (protagonistNames.length > 0) {
    let totalMentions = 0;
    for (const name of protagonistNames) {
      // CJK names use literal match, ASCII uses word boundary
      const hasCJK = /[一-鿿]/.test(name);
      const boundary = hasCJK ? '' : '\\b';
      const re = new RegExp(`${boundary}${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}${boundary}`, 'gi');
      const matches = content.match(re);
      if (matches) totalMentions += matches.length;
    }
    if (totalMentions < minMentions) return 'sub';
  }

  return 'main';
}

// ═══ Structured split ═══

export interface StructuredSplitOptions {
  protagonistNames?: string[];
  minMentions?: number;
}

/**
 * Split text into a structured chapter tree with hierarchy and line classification.
 *
 *   1. Title-based chapter splitting (existing)
 *   2. Volume detection → nest chapters under volumes
 *   3. Main/sub line classification per chapter
 */
export function splitChaptersStructured(
  text: string,
  options: StructuredSplitOptions = {}
): StructuredResult {
  const { protagonistNames = [], minMentions = 3 } = options;

  // Step 1: Flat split
  const flatResult = splitChapters(text);
  const lines = text.split('\n');

  // Step 2: Detect volume markers and their line positions
  const volumeMarkers: { lineIdx: number; number: number; title?: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const vol = detectVolume(lines[i]);
    if (vol) volumeMarkers.push({ lineIdx: i, ...vol });
  }

  // Step 3: Build chapter nodes
  const createChapterNode = (ch: ChapterInfo, idx: number, parentIdx?: number): ChapterNode => {
    const lineType = classifyLineType(ch.content, ch.title, protagonistNames, minMentions);
    const num = ch.title ? extractChapterNum(ch.title) : null;
    return {
      index: idx, title: ch.title, content: ch.content, wordCount: ch.wordCount,
      level: 'chapter', parentIndex: parentIdx, children: [], lineType,
      // extractChapterNum works on full chapter line; from index+1 as fallback
      number: num != null ? num : idx + 1,
    };
  };

  const flatList: ChapterNode[] = [];
  const volumeNodes: ChapterNode[] = [];
  const chaptersInVolume = new Map<number, number>();

  if (volumeMarkers.length > 0) {
    // Create volume nodes
    for (const vm of volumeMarkers) {
      volumeNodes.push({
        index: volumeNodes.length,
        title: vm.title ? `第${vm.number}卷 ${vm.title}` : `第${vm.number}卷`,
        content: '', wordCount: 0, level: 'volume',
        children: [], lineType: 'main', number: vm.number,
      });
    }

    // Assign chapters to volumes by line position
    const boundaries = findChapterBoundaries(text);
    for (let ci = 0; ci < flatResult.chapters.length; ci++) {
      const ch = flatResult.chapters[ci];
      const chStartIdx = text.indexOf(ch.content.slice(0, 50));
      const chLine = chStartIdx >= 0 ? text.slice(0, chStartIdx).split('\n').length : 0;

      let volIdx = -1;
      for (let vi = 0; vi < volumeMarkers.length; vi++) {
        if (volumeMarkers[vi].lineIdx < (chLine > 0 ? chLine : boundaries[ci] || 0)) volIdx = vi;
      }
      if (volIdx >= 0) chaptersInVolume.set(ci, volIdx);
    }

    // Assemble tree
    for (let vi = 0; vi < volumeNodes.length; vi++) {
      for (let ci = 0; ci < flatResult.chapters.length; ci++) {
        if (chaptersInVolume.get(ci) === vi) {
          const node = createChapterNode(flatResult.chapters[ci], flatList.length, vi);
          volumeNodes[vi].children.push(node);
          volumeNodes[vi].wordCount += flatResult.chapters[ci].wordCount;
          flatList.push(node);
        }
      }
    }

    // Unassigned chapters → root level
    for (let ci = 0; ci < flatResult.chapters.length; ci++) {
      if (!chaptersInVolume.has(ci)) {
        flatList.push(createChapterNode(flatResult.chapters[ci], flatList.length));
      }
    }

    volumeNodes.sort((a, b) => (a.number || 0) - (b.number || 0));
  } else {
    // No volumes: flat chapters
    for (let ci = 0; ci < flatResult.chapters.length; ci++) {
      flatList.push(createChapterNode(flatResult.chapters[ci], flatList.length));
    }
  }

  return {
    rootChildren: volumeNodes.length > 0 ? volumeNodes : flatList,
    flatList,
    chapters: flatResult.chapters,
    matchedMode: flatResult.matchedMode,
    isFallback: flatResult.isFallback,
  };
}
