import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { assertSafeObjectKey, buildObjectKey, isSha256Hex, resolveObjectPath } from './object-key.js';

const GOOD_SHA = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('对象键内容寻址与路径安全', () => {
  it('buildObjectKey 按 sha256 前缀分片', () => {
    expect(buildObjectKey(GOOD_SHA)).toBe(`obj/${GOOD_SHA.slice(0, 2)}/${GOOD_SHA.slice(2, 4)}/${GOOD_SHA}`);
  });

  it('buildObjectKey 拒绝非 64 位十六进制 sha256', () => {
    expect(() => buildObjectKey('nothex')).toThrow();
    expect(() => buildObjectKey(GOOD_SHA.slice(0, 63))).toThrow();
  });

  it('isSha256Hex 识别合法与非法', () => {
    expect(isSha256Hex(GOOD_SHA)).toBe(true);
    expect(isSha256Hex('NO')).toBe(false);
    expect(isSha256Hex(GOOD_SHA.toUpperCase())).toBe(false);
  });

  it('assertSafeObjectKey 接受内容寻址键', () => {
    expect(() => assertSafeObjectKey(buildObjectKey(GOOD_SHA))).not.toThrow();
  });

  it.each([
    ['空字符串', ''],
    ['前导斜杠的绝对路径', '/etc/passwd'],
    ['Windows 盘符正斜杠', 'C:/x'],
    ['Windows 盘符反斜杠', 'C:\\x'],
    ['反斜杠段', 'obj\\ab\\x'],
    ['上级目录段', 'obj/../etc'],
    ['当前目录段', 'obj/./ab'],
    ['空段', 'obj//ab'],
    ['NUL 字符', 'obj/x\x00y'],
    ['控制字符换行', 'obj/x\ny'],
  ])('assertSafeObjectKey 拒绝 %s', (_label, key) => {
    expect(() => assertSafeObjectKey(key)).toThrow();
  });

  it('resolveObjectPath 把合法键定位到根目录之内', () => {
    const root = resolve('D:', 'objects');
    const path = resolveObjectPath(root, buildObjectKey(GOOD_SHA));
    expect(path.startsWith(root)).toBe(true);
    expect(path).toBe(resolve(root, buildObjectKey(GOOD_SHA)));
  });

  it('resolveObjectPath 对非法键抛错', () => {
    const root = resolve('D:', 'objects');
    expect(() => resolveObjectPath(root, '../escape')).toThrow();
  });
});
