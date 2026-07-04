// ═══ Noise Categories ═══
export type NoiseCategory = 'url' | 'promo' | 'template' | 'decoration' | 'repeated' | 'garbled' | 'meta';

export interface SuspectLine {
  lineNum: number;
  content: string;
  category: NoiseCategory;
  confidence: number;
}

export interface FilterReport {
  suspectLines: SuspectLine[];
  totalCount: number;
  removedCount: number;
  byCategory: Record<NoiseCategory, number>;
  /** Lines remaining after filtering */
  linesAfter: number;
}

// ── Helpers ──
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── URL patterns ──
const URL_RE = /(?:https?:\/\/|www\.)\S+|\S+\.(?:com|cn|net|org|cc|me|io|xyz|top|vip|club)\b/gi;

// ── Promo keywords ──
// 注意：“关注”不作为裸关键词。它是正文里极常见的叙事词
// （“关注着”“表示过多的关注”“被这般关注”），裸匹配会把大段正文误判成推广。
// 真正的推广性“关注”几乎都会和下面的“公众号 / 微信 / 书友群 …”同时出现，已被覆盖；
// 漏掉的只有“求关注 / 点个关注”这种极少数不带任何平台词的纯号召，可接受。
const PROMO_KEYWORDS = [
  '公众号', '微信', 'QQ群', 'qq群', 'QQ 群', '书友群', '读者群',
  '订阅', '下载APP', '下载 APP', '扫码', '二维码',
  '加群', '入群', '微信号', '公号', '百度搜索',
  '最新章节', '全文阅读', '继续阅读',
];
const PROMO_RE = new RegExp(PROMO_KEYWORDS.map(escapeRegex).join('|'), 'i');

// ── Template patterns ──
const TEMPLATE_PATTERNS = [
  /本书由.{1,20}整理/,
  /更多.{1,30}(?:请访问|请到|请搜索|请关注)/,
  /本(?:文|书|章)来自/,
  /(?:免费|正版).{0,10}(?:小说|阅读)/,
  /(?:转载|搬运).{0,10}(?:请注明|出处)/,
  /(?:起点|纵横|17k|晋江|红袖|潇湘|飞卢|番茄).{0,20}(?:首发|原创|独家|连载)/,
  /(?:txt|TXT).{0,10}(?:下载|全集|全本)/,
  /(?:新书|新作).{0,10}(?:求收藏|求推荐|求月票|求打赏)/,
  /(?:收藏|推荐|月票|打赏).{0,5}(?:感谢|谢谢|多谢)/,
];

// ── Decoration ──
const DECORATION_RE = /^[\s]*[-=*#~_※◆◇■□●○▲△▼▽☆★♦♣♠♥┅┄┈═╌]{5,}\s*$/;

// ── Author meta-sections ──
const AUTHOR_NOTE_START = /^[\s]*[（(]?(?:作者|笔者|写手|[Pp][Ss])[：:，,、\s]?(?:的话|题外话|感言|留言|请假|请假条|请假通知|停更|断更|今日|昨天|昨天一|今日一|大家|唠|碎碎念|叨叨)/;
const AUTHOR_NOTE_END = /^[\s]*[）)]?\s*(?:以上|完毕|结束|over|就这样|谢谢|感谢)[\s。.]*$/i;

// ── Garbled text ──
// Valid chars: CJK, Latin, digits, common punctuation, whitespace
// 0x3000 = fullwidth space, 0x3040-0x9FFF = CJK range, 0xFF00-0xFFEF = halfwidth/fullwidth forms
function isGarbled(line: string): boolean {
  if (line.length < 10) return false;
  let bad = 0;
  for (const c of line) {
    const cp = c.codePointAt(0)!;
    // Whitespace
    if (cp <= 0x20 || cp === 0x3000) continue;
    // CJK
    if (cp >= 0x4e00 && cp <= 0x9fff) continue;
    // Fullwidth forms + punctuation
    if (cp >= 0xff00 && cp <= 0xffef) continue;
    // CJK punctuation/symbols
    if (cp >= 0x3000 && cp <= 0x303f) continue;
    // Latin, digits, ASCII punctuation
    if (cp >= 0x21 && cp <= 0x7e) continue;
    bad++;
  }
  return (bad / line.length) > 0.4;
}

// ── Standalone / navigation ──
const PAGE_NUM_RE = /^\s*\d+\s*\/\s*\d+\s*$/;
const NAV_CHAPTER_RE = /^\s*(?:上一章|下一章|返回目录|章节目录|目录)\s*$/i;

// ═══ Detectors ═══

function detectUrls(lines: string[]): SuspectLine[] {
  const results: SuspectLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (URL_RE.test(line)) {
      // If the line has substantial non-URL content, it's not pure URL noise
      const withoutUrl = line.replace(URL_RE, '').trim();
      if (withoutUrl.length > 30) continue;
      results.push({ lineNum: i + 1, content: line.slice(0, 100), category: 'url', confidence: 0.9 });
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
      results.push({ lineNum: i + 1, content: lines[i].trim().slice(0, 100), category: 'decoration', confidence: 0.9 });
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
    if (count >= threshold) repeatedLines.add(line);
  }

  if (repeatedLines.size === 0) return [];

  const results: SuspectLine[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (repeatedLines.has(lines[i].trim())) {
      results.push({ lineNum: i + 1, content: lines[i].trim().slice(0, 100), category: 'repeated', confidence: 0.75 });
    }
  }
  return results;
}

function detectGarbled(lines: string[]): SuspectLine[] {
  const results: SuspectLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (isGarbled(line)) {
      results.push({ lineNum: i + 1, content: line.slice(0, 100), category: 'garbled', confidence: 0.85 });
    }
  }
  return results;
}

function detectMeta(lines: string[]): SuspectLine[] {
  const results: SuspectLine[] = [];

  let inAuthorNote = false;
  let authorNoteStart = -1; // 记录留言块起始行，用于限制最多吃 30 行
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Author note block detection
    if (!inAuthorNote && AUTHOR_NOTE_START.test(line) && line.length < 80) {
      inAuthorNote = true;
      authorNoteStart = i;
      results.push({ lineNum: i + 1, content: line.slice(0, 100), category: 'meta', confidence: 0.9 });
      continue;
    }
    if (inAuthorNote) {
      results.push({ lineNum: i + 1, content: line.slice(0, 100), category: 'meta', confidence: 0.7 });
      // 结束条件：遇到结束标记，或已超过起始行 30 行
      //（原来比的是 results 最后一行的 lineNum，恒为当前行，这条永不触发 → 没有结束标记时会把整本书正文吞掉）
      if (AUTHOR_NOTE_END.test(line) || i - authorNoteStart >= 30) {
        inAuthorNote = false;
        authorNoteStart = -1;
      }
      continue;
    }

    // Page number / navigation
    if (PAGE_NUM_RE.test(line) || NAV_CHAPTER_RE.test(line)) {
      results.push({ lineNum: i + 1, content: line.slice(0, 100), category: 'meta', confidence: 0.95 });
      continue;
    }

    // Single orphan character (not a valid paragraph)
    if (line.length === 1 && /[一-鿿]/.test(line)) {
      results.push({ lineNum: i + 1, content: line, category: 'meta', confidence: 0.6 });
    }
  }

  return results;
}

// ═══ Main ═══

export function detectNoise(text: string): FilterReport {
  const lines = text.split('\n');
  const allSuspects: SuspectLine[] = [];

  allSuspects.push(...detectUrls(lines));
  allSuspects.push(...detectPromo(lines));
  allSuspects.push(...detectTemplate(lines));
  allSuspects.push(...detectDecoration(lines));
  allSuspects.push(...detectGarbled(lines));
  allSuspects.push(...detectMeta(lines));

  const roughSections = text.split('\n\n\n').filter(s => s.trim());
  allSuspects.push(...detectRepeatedTails(text, roughSections));

  // Deduplicate by line number, keep highest confidence
  const byLine = new Map<number, SuspectLine>();
  for (const s of allSuspects) {
    const existing = byLine.get(s.lineNum);
    if (!existing || s.confidence > existing.confidence) {
      byLine.set(s.lineNum, s);
    }
  }
  const deduped = Array.from(byLine.values()).sort((a, b) => a.lineNum - b.lineNum);

  const byCategory = {
    url: 0, promo: 0, template: 0, decoration: 0, repeated: 0, garbled: 0, meta: 0,
  } as Record<NoiseCategory, number>;
  for (const s of deduped) byCategory[s.category]++;

  return {
    suspectLines: deduped,
    totalCount: deduped.length,
    removedCount: 0, // filled by cleanText
    byCategory,
    linesAfter: lines.length,
  };
}

/**
 * Remove detected noise lines from text.
 * @param text Original text
 * @param report Report from detectNoise()
 * @param mode 'conservative' (confidence >= 0.8) or 'aggressive' (all)
 */
export function cleanText(
  text: string,
  report: FilterReport,
  mode: 'conservative' | 'aggressive' = 'conservative'
): string {
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
  report.removedCount = lines.length - cleaned.length;
  report.linesAfter = cleaned.length;
  return cleaned.join('\n');
}
