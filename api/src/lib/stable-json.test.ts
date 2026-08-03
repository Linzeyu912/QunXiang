import { describe, expect, it } from 'vitest';
import { stabilize, stableStringify } from './stable-json.js';

describe('stableStringify', () => {
  it('对象键按字母序排序', () => {
    expect(stableStringify({ b: 1, a: 2, c: 3 })).toBe('{"a":2,"b":1,"c":3}');
  });

  it('键顺序不同产生相同字符串', () => {
    expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }));
  });

  it('嵌套对象递归排序', () => {
    expect(stableStringify({ outer: { z: 1, a: 2 } })).toBe('{"outer":{"a":2,"z":1}}');
  });

  it('数组顺序保持不变', () => {
    expect(stableStringify([3, 1, 2])).toBe('[3,1,2]');
  });

  it('中文 UTF-8 稳定', () => {
    expect(stableStringify({ 名: '云端书库' })).toBe('{"名":"云端书库"}');
  });
});
