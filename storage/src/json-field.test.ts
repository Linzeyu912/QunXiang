import { describe, expect, it } from 'vitest';
import { decodeJsonField, encodeJsonField } from './json-field.js';

describe('PostgreSQL JSON 字段边界', () => {
  it('读取 PostgreSQL JSON 值时保持结构', () => {
    expect(decodeJsonField(['甲', '乙'], [])).toEqual(['甲', '乙']);
  });

  it('迁移期仍可读取旧 JSON 字符串', () => {
    expect(decodeJsonField('["甲","乙"]', [])).toEqual(['甲', '乙']);
  });

  it('空值或损坏字符串返回安全默认值', () => {
    expect(decodeJsonField(null, [])).toEqual([]);
    expect(decodeJsonField('不是 JSON', { ok: false })).toEqual({ ok: false });
  });

  it('写入 PostgreSQL 时不再序列化为字符串', () => {
    const value = { chapters: [1, 2] };
    expect(encodeJsonField(value)).toBe(value);
  });
});
