// Fullwidth → halfwidth: only letters, digits, and dot (the rest are valid CJK punctuation)
const FW_MAP: Record<string, string> = {
  'Ａ': 'A', 'Ｂ': 'B', 'Ｃ': 'C', 'Ｄ': 'D', 'Ｅ': 'E', 'Ｆ': 'F', 'Ｇ': 'G', 'Ｈ': 'H', 'Ｉ': 'I', 'Ｊ': 'J', 'Ｋ': 'K', 'Ｌ': 'L', 'Ｍ': 'M', 'Ｎ': 'N', 'Ｏ': 'O', 'Ｐ': 'P', 'Ｑ': 'Q', 'Ｒ': 'R', 'Ｓ': 'S', 'Ｔ': 'T', 'Ｕ': 'U', 'Ｖ': 'V', 'Ｗ': 'W', 'Ｘ': 'X', 'Ｙ': 'Y', 'Ｚ': 'Z',
  'ａ': 'a', 'ｂ': 'b', 'ｃ': 'c', 'ｄ': 'd', 'ｅ': 'e', 'ｆ': 'f', 'ｇ': 'g', 'ｈ': 'h', 'ｉ': 'i', 'ｊ': 'j', 'ｋ': 'k', 'ｌ': 'l', 'ｍ': 'm', 'ｎ': 'n', 'ｏ': 'o', 'ｐ': 'p', 'ｑ': 'q', 'ｒ': 'r', 'ｓ': 's', 'ｔ': 't', 'ｕ': 'u', 'ｖ': 'v', 'ｗ': 'w', 'ｘ': 'x', 'ｙ': 'y', 'ｚ': 'z',
  '０': '0', '１': '1', '２': '2', '３': '3', '４': '4', '５': '5', '６': '6', '７': '7', '８': '8', '９': '9',
  '．': '.',
};
const FW_RE = /[Ａ-Ｚａ-ｚ０-９．]/g;

// Zero-width and invisible characters (code points)
const ZERO_WIDTH_CODES = new Set([0x200b, 0x200c, 0x200d, 0xfeff, 0x00ad, 0x200e, 0x200f]);
// Irregular whitespace (keep ASCII 0x20 space, 0x09 tab, 0x0a LF, 0x0d CR)
const IRREGULAR_WS_CODES = new Set([0x00a0, 0x1680, 0x180e, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000]);

export interface NormalizeReport {
  /** Number of CRLF → LF replacements */
  crlfFixed: number;
  /** Number of fullwidth characters converted */
  fullwidthFixed: number;
  /** Number of zero-width / invisible characters removed */
  invisibleRemoved: number;
  /** Number of irregular whitespace characters normalized */
  whitespaceFixed: number;
  /** Number of blank line groups compressed (3+ → 2) */
  blankCompressed: number;
}

/**
 * Full text normalization pipeline:
 *   1. CRLF → LF
 *   2. Remove zero-width / invisible characters
 *   3. Normalize irregular whitespace to ASCII space
 *   4. Fullwidth → halfwidth conversion
 *   5. Strip trailing whitespace per line
 *   6. Compress excessive blank lines (3+ → 2)
 */
export function normalize(text: string): { text: string; report: NormalizeReport } {
  const report: NormalizeReport = {
    crlfFixed: 0,
    fullwidthFixed: 0,
    invisibleRemoved: 0,
    whitespaceFixed: 0,
    blankCompressed: 0,
  };

  let result = text;

  // 1. CRLF → LF
  const beforeCRLF = result.length;
  result = result.replace(/\r\n/g, '\n');
  result = result.replace(/\r/g, '\n');
  report.crlfFixed = beforeCRLF - result.length;

  // 2. Remove zero-width / invisible characters
  let beforeZW = result.length;
  let cleaned = '';
  for (const c of result) {
    if (!ZERO_WIDTH_CODES.has(c.codePointAt(0)!)) {
      cleaned += c;
    }
  }
  report.invisibleRemoved = beforeZW - cleaned.length;
  result = cleaned;

  // 3. Normalize irregular whitespace → ASCII space
  let wsCount = 0;
  cleaned = '';
  for (const c of result) {
    if (IRREGULAR_WS_CODES.has(c.codePointAt(0)!)) {
      cleaned += ' ';
      wsCount++;
    } else {
      cleaned += c;
    }
  }
  report.whitespaceFixed = wsCount;
  result = cleaned;

  // 4. Fullwidth → halfwidth
  const fwMatches = result.match(FW_RE);
  if (fwMatches) report.fullwidthFixed = fwMatches.length;
  result = result.replace(FW_RE, c => FW_MAP[c] ?? c);

  // 5. Strip trailing whitespace per line
  result = result.replace(/[ \t]+$/gm, '');

  // 6. Compress blank lines: 3+ → 2 (one blank line between paragraphs)
  const beforeBlank = result.length;
  result = result.replace(/\n{3,}/g, '\n\n');
  report.blankCompressed = beforeBlank - result.length;

  // 7. Strip leading/trailing blank lines
  result = result.replace(/^\n+/, '').replace(/\n+$/, '');

  return { text: result, report };
}
