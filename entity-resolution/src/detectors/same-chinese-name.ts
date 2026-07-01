/**
 * Chinese address-form normalization — a light safety net for merging character
 * entries that the LLM emitted separately despite being the same person under a
 * address form (e.g. "萧炎哥" should merge into "萧炎").
 *
 * This is intentionally narrow: it only strips classic name prefixes/suffixes
 * and requires an exact match after normalization (no substring/includes, to
 * avoid merging distinct names like "张三" / "张三丰"). It does NOT decide which
 * entities exist — it only helps merge already-emitted duplicates.
 */

const NAME_PREFIXES = ['老', '小', '阿'];

// Longest-first ordering is applied at use, so multi-char suffixes (少爷/小姐/大人)
// are tried before single-char ones.
const NAME_SUFFIXES = ['少爷', '小姐', '大人', '哥', '弟', '姐', '妹', '叔', '姨', '公', '婆', '爷', '奶', '儿', '郎', '娘', '姑'];

export function normalizeChineseName(name: string): string {
  let n = name.trim().replace(/薰/g, '熏');

  for (const prefix of NAME_PREFIXES) {
    if (n.startsWith(prefix) && n.length > prefix.length + 1) {
      n = n.slice(prefix.length);
      break;
    }
  }

  const suffixes = [...NAME_SUFFIXES].sort((a, b) => b.length - a.length);
  for (const suffix of suffixes) {
    if (n.endsWith(suffix) && n.length - suffix.length >= 2) {
      n = n.slice(0, n.length - suffix.length);
      break;
    }
  }

  return n;
}

export function isSameChineseName(a: string, b: string): boolean {
  const na = normalizeChineseName(a);
  const nb = normalizeChineseName(b);
  return na.length >= 2 && nb.length >= 2 && na === nb;
}
