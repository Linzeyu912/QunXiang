export type NoiseCategory = 'url' | 'promo' | 'template' | 'decoration' | 'repeated';

export interface SuspectLine {
  lineNum: number;
  content: string;
  category: NoiseCategory;
  confidence: number;
}

export interface SanitizeReport {
  suspectLines: SuspectLine[];
  totalCount: number;
  byCategory: Record<NoiseCategory, number>;
}

// ── URL pattern ──
const URL_RE = /(?:https?:\/\/|www\.)\S+|\S+\.(?:com|cn|net|org|cc|me|io|xyz|top|vip|club)\b/gi;

// Fullwidth → halfwidth mapping
const FW_TO_HW_MAP: Record<string, string> = {
  'Ａ': 'A', 'Ｂ': 'B', 'Ｃ': 'C', 'Ｄ': 'D', 'Ｅ': 'E',
  'Ｆ': 'F', 'Ｇ': 'G', 'Ｈ': 'H', 'Ｉ': 'I', 'Ｊ': 'J',
  'Ｋ': 'K', 'Ｌ': 'L', 'Ｍ': 'M', 'Ｎ': 'N', 'Ｏ': 'O',
  'Ｐ': 'P', 'Ｑ': 'Q', 'Ｒ': 'R', 'Ｓ': 'S', 'Ｔ': 'T',
  'Ｕ': 'U', 'Ｖ': 'V', 'Ｗ': 'W', 'Ｘ': 'X', 'Ｙ': 'Y',
  'Ｚ': 'Z',
  'ａ': 'a', 'ｂ': 'b', 'ｃ': 'c', 'ｄ': 'd', 'ｅ': 'e',
  'ｆ': 'f', 'ｇ': 'g', 'ｈ': 'h', 'ｉ': 'i', 'ｊ': 'j',
  'ｋ': 'k', 'ｌ': 'l', 'ｍ': 'm', 'ｎ': 'n', 'ｏ': 'o',
  'ｐ': 'p', 'ｑ': 'q', 'ｒ': 'r', 'ｓ': 's', 'ｔ': 't',
  'ｕ': 'u', 'ｖ': 'v', 'ｗ': 'w', 'ｘ': 'x', 'ｙ': 'y',
  'ｚ': 'z',
  '．': '.',
};

function fullwidthToHalfwidth(str: string): string {
  return str.replace(/[Ａ-Ｚａ-ｚ．]/g, c => FW_TO_HW_MAP[c] ?? c);
}

// Watermark patterns for obfuscated site names
const WATERMARK_PATTERNS = [
  /大.学.+生.+小.+说.网/,
  /小.?说.?天.?堂/,
  /笔.?趣.?阁/,
  /顶.?点.?小.?说/,
];

// ── Promo keywords ──
const PROMO_KEYWORDS = [
  '公众号', '微信', 'QQ群', 'qq群', 'QQ 群',
  '关注', '订阅', '书友群', '读者群',
  '下载APP', '下载app', '下载 APP',
  '扫码', '二维码', '加群', '入群',
  '微信号', '微信公众', '公号',
  '百度搜索', '搜索引擎',
  'WeChat', 'wechat',
];
const PROMO_RE = new RegExp(PROMO_KEYWORDS.map(k => escapeRegex(k)).join('|'), 'i');

// ── Template patterns ──
const TEMPLATE_PATTERNS = [
  /本书由.{1,20}整理/,
  /更多.{1,30}(?:请访问|请到|请搜索)/,
  /手机用户请到.{1,30}阅读/,
  /本(?:文|书|章)来自/,
  /(?:免费|正版).{0,10}(?:小说|阅读)/,
  /(?:转载|搬运).{0,10}(?:请注明|出处)/,
  /(?:起点|纵横|17k|晋江|红袖|潇湘|飞卢|番茄).{0,20}(?:首发|原创|独家|连载)/,
  /(?:txt|TXT).{0,10}(?:下载|全集|全本)/,
  /(?:新书|新作).{0,10}(?:求收藏|求推荐|求月票|求打赏)/,
  /(?:收藏|推荐|月票|打赏).{0,5}(?:感谢|谢谢|多谢)/,
];

// ── Decoration patterns ──
const DECORATION_RE = /^[\s]*[-=*#~_※◆◇■□●○▲△▼▽☆★♦♣♠♥]{5,}\s*$/;

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function detectUrls(lines: string[]): SuspectLine[] {
  const results: SuspectLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    if (URL_RE.test(line)) {
      results.push({ lineNum: i + 1, content: line.slice(0, 100), category: 'url', confidence: 0.9 });
      continue;
    }

    // Check obfuscated URL
    const normalized = fullwidthToHalfwidth(line.replace(/[\s　]/g, ''));
    URL_RE.lastIndex = 0;
    if (URL_RE.test(normalized)) {
      results.push({ lineNum: i + 1, content: line.slice(0, 100), category: 'url', confidence: 0.85 });
      continue;
    }

    // Check watermark patterns
    if (line.length < 30) {
      for (const wp of WATERMARK_PATTERNS) {
        if (wp.test(line)) {
          results.push({ lineNum: i + 1, content: line.slice(0, 100), category: 'promo', confidence: 0.9 });
          break;
        }
      }
    }
  }
  return results;
}

function detectPromo(lines: string[]): SuspectLine[] {
  const results: SuspectLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.length > 200) continue;
    if (PROMO_RE.test(line)) {
      results.push({ lineNum: i + 1, content: line.slice(0, 100), category: 'promo', confidence: 0.85 });
    }
  }
  return results;
}

function detectTemplate(lines: string[]): SuspectLine[] {
  const results: SuspectLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.length > 200) continue;
    for (const pat of TEMPLATE_PATTERNS) {
      if (pat.test(line)) {
        results.push({ lineNum: i + 1, content: line.slice(0, 100), category: 'template', confidence: 0.8 });
        break;
      }
    }
  }
  return results;
}

function detectDecoration(lines: string[]): SuspectLine[] {
  const results: SuspectLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (DECORATION_RE.test(lines[i])) {
      results.push({ lineNum: i + 1, content: lines[i].trim().slice(0, 100), category: 'decoration', confidence: 0.7 });
    }
  }
  return results;
}

function detectRepeatedTails(text: string, sections: string[]): SuspectLine[] {
  if (sections.length < 4) return [];

  const tailCounter: Record<string, number> = {};
  for (const section of sections) {
    const sectionLines = section.trim().split('\n');
    const tails = sectionLines.slice(-5);
    for (const line of tails) {
      const stripped = line.trim();
      if (stripped && stripped.length > 3) {
        tailCounter[stripped] = (tailCounter[stripped] || 0) + 1;
      }
    }
  }

  const threshold = sections.length * 0.5;
  const repeatedLines = new Set<string>();
  for (const [line, count] of Object.entries(tailCounter)) {
    if (count >= threshold) {
      repeatedLines.add(line);
    }
  }

  if (repeatedLines.size === 0) return [];

  const results: SuspectLine[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const stripped = lines[i].trim();
    if (repeatedLines.has(stripped)) {
      results.push({ lineNum: i + 1, content: stripped.slice(0, 100), category: 'repeated', confidence: 0.75 });
    }
  }
  return results;
}

/**
 * Detect noise in text across 5 categories.
 */
export function detectNoise(text: string): SanitizeReport {
  const lines = text.split('\n');
  const allSuspects: SuspectLine[] = [];

  allSuspects.push(...detectUrls(lines));
  allSuspects.push(...detectPromo(lines));
  allSuspects.push(...detectTemplate(lines));
  allSuspects.push(...detectDecoration(lines));

  // For repeated tails, use double-newline as rough chapter proxy
  const roughSections = text.split('\n\n\n').filter(s => s.trim());
  allSuspects.push(...detectRepeatedTails(text, roughSections));

  // Deduplicate by line number (keep highest confidence)
  const byLine = new Map<number, SuspectLine>();
  for (const s of allSuspects) {
    const existing = byLine.get(s.lineNum);
    if (!existing || s.confidence > existing.confidence) {
      byLine.set(s.lineNum, s);
    }
  }
  const deduped = Array.from(byLine.values()).sort((a, b) => a.lineNum - b.lineNum);

  // Build category counts
  const byCategory = { url: 0, promo: 0, template: 0, decoration: 0, repeated: 0 } as Record<NoiseCategory, number>;
  for (const s of deduped) {
    byCategory[s.category]++;
  }

  return {
    suspectLines: deduped,
    totalCount: deduped.length,
    byCategory,
  };
}

/**
 * Remove noise lines from text.
 * @param text Original text
 * @param report Report from detectNoise()
 * @param mode 'conservative' (confidence >= 0.8) or 'aggressive' (all)
 */
export function cleanText(text: string, report: SanitizeReport, mode: 'conservative' | 'aggressive' = 'conservative'): string {
  if (report.suspectLines.length === 0) return text;

  const threshold = mode === 'conservative' ? 0.8 : 0;
  const linesToRemove = new Set<number>();
  for (const s of report.suspectLines) {
    if (s.confidence >= threshold) {
      linesToRemove.add(s.lineNum);
    }
  }

  if (linesToRemove.size === 0) return text;

  const lines = text.split('\n');
  const cleaned = lines.filter((_, i) => !linesToRemove.has(i + 1));
  return cleaned.join('\n');
}
