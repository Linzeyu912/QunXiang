/** UTF-8 BOM marker */
const UTF8_BOM = [0xef, 0xbb, 0xbf];

type Encoding = 'utf-8' | 'gb18030';

/**
 * Detect text encoding from raw bytes.
 * Tries UTF-8 first, then GB18030 (superset of GBK/GB2312).
 */
export function detectEncoding(raw: Buffer): Encoding {
  const sample = raw.subarray(0, Math.min(raw.length, 102400));

  // Try UTF-8 first
  try {
    sample.toString('utf-8');
    return 'utf-8';
  } catch {
    // continue
  }

  // Try GB18030 — trim 0-3 bytes to handle boundary splits
  for (let trim = 0; trim < 4; trim++) {
    const trimmed = sample.subarray(0, Math.max(0, sample.length - trim));
    if (trimmed.length === 0) continue;
    try {
      // Use any cast because TypeScript doesn't have gb18030 in its types
      // but Node.js supports it
      (trimmed as Buffer).toString('gb18030' as BufferEncoding);
      return 'gb18030';
    } catch {
      continue;
    }
  }

  return 'utf-8';
}

/**
 * Decode raw bytes to string with automatic encoding detection.
 * Strips UTF-8 BOM if present.
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

  if (encoding === 'utf-8') {
    try {
      return bytes.toString('utf-8');
    } catch {
      // Fallback to GB18030
      try {
        return (bytes as Buffer).toString('gb18030' as BufferEncoding);
      } catch {
        return bytes.toString('utf-8') ?? '';
      }
    }
  }

  try {
    return (bytes as Buffer).toString('gb18030' as BufferEncoding);
  } catch {
    try {
      return (bytes as Buffer).toString('gb18030' as BufferEncoding);
    } catch {
      return bytes.toString('utf-8') ?? '';
    }
  }
}
