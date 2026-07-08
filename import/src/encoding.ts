import iconv from 'iconv-lite';

/** UTF-8 BOM marker */
const UTF8_BOM = [0xef, 0xbb, 0xbf];

type Encoding = 'utf-8' | 'gb18030';

/**
 * 校验一段字节是否为合法的 UTF-8 多字节序列。
 * UTF-8 编码规则：
 *   - 单字节：0xxxxxxx（0x00-0x7F）
 *   - 2 字节：110xxxxx 10xxxxxx（首字节 0xC0-0xDF，后跟 1 个 0x80-0xBF）
 *   - 3 字节：1110xxxx 10xxxxxx 10xxxxxx（首字节 0xE0-0xEF，后跟 2 个 continuation）
 *   - 4 字节：11110xxx 10xxxxxx 10xxxxxx 10xxxxxx（首字节 0xF0-0xF7，后跟 3 个 continuation）
 * 任何违反规则的字节（如孤立的 0x80-0xBF、或首字节后 continuation 数量不足）
 * 都说明这不是合法 UTF-8。
 *
 * 不依赖 Buffer.toString('utf-8') 是否抛异常——它对任意字节都不抛，
 * 只把非法字节替换成 U+FFFD，所以旧的 try/catch 检测是死代码。
 */
function isValidUtf8(bytes: Buffer): boolean {
  let i = 0;
  // 抽样校验前 100KB 即可判断（避免对超大文件全文扫描）
  const end = Math.min(bytes.length, 102400);
  while (i < end) {
    const b0 = bytes[i];
    if (b0 < 0x80) {
      // ASCII，单字节
      i++;
      continue;
    }
    let expectedLen: number;
    if ((b0 & 0xe0) === 0xc0) expectedLen = 2;        // 110xxxxx
    else if ((b0 & 0xf0) === 0xe0) expectedLen = 3;   // 1110xxxx
    else if ((b0 & 0xf8) === 0xf0) expectedLen = 4;   // 11110xxx
    else return false;                                 // 非法首字节（10xxxxxx 或 0xF8+）

    // 检查后续 expectedLen-1 个字节都是 10xxxxxx（0x80-0xBF）
    for (let j = 1; j < expectedLen; j++) {
      if (i + j >= end) break; // 截断到采样边界，视为合法（边界情况容忍）
      if ((bytes[i + j] & 0xc0) !== 0x80) return false;
    }
    i += expectedLen;
  }
  return true;
}

/**
 * Detect text encoding from raw bytes.
 * Tries UTF-8 first（用严格的字节序列校验），then GB18030（GBK/GB2312 超集）。
 */
export function detectEncoding(raw: Buffer): Encoding {
  const sample = raw.subarray(0, Math.min(raw.length, 102400));
  if (sample.length === 0) return 'utf-8';

  // 严格 UTF-8 有效性校验：发现非法多字节序列即判非 UTF-8
  if (isValidUtf8(sample)) {
    return 'utf-8';
  }
  return 'gb18030';
}

/**
 * Decode raw bytes to string with automatic encoding detection.
 * Strips UTF-8 BOM if present.
 *
 * 使用 iconv-lite 解码——Node 原生 Buffer.toString 不支持 gb18030/gbk
 *（会抛 Unknown encoding），所以旧代码里 toString('gb18030') 是无效死代码。
 */
export function decodeText(raw: Buffer): string {
  // Strip UTF-8 BOM
  let bytes = raw;
  if (raw.length >= 3 &&
      raw[0] === UTF8_BOM[0] &&
      raw[1] === UTF8_BOM[1] &&
      raw[2] === UTF8_BOM[2]) {
    bytes = raw.subarray(3);
  }

  const encoding = detectEncoding(bytes);
  // gb18030 是 GBK/GB2312 的超集，能覆盖国内常见编码
  return iconv.decode(bytes, encoding === 'gb18030' ? 'gb18030' : 'utf-8');
}
