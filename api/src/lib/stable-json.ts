/**
 * 确定性 JSON 序列化：对象键按字母序、数组保持顺序、无多余空白。
 * 同一输入永远产生同一字符串，供 manifest 与 contentRevision 复用。
 */
export function stabilize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stabilize);
  if (value && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = stabilize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(stabilize(value));
}
