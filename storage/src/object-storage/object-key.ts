/**
 * 对象键：内容寻址（sha256）分片，跨书籍去重；逻辑路径在快照层表达。
 * 路径安全：对象键只允许相对、无反斜杠、无盘符/协议、无点段、无控制字符。
 */
import { resolve as resolvePath, sep } from 'node:path';

const SHA256_HEX_RE = /^[0-9a-f]{64}$/;
const CONTROL_CHAR_RE = /[\x00-\x1f\x7f]/;
const DRIVE_OR_SCHEME_RE = /^[A-Za-z]:[\\/]|:\/\//;

export function isSha256Hex(value: string): boolean {
  return SHA256_HEX_RE.test(value);
}

export function buildObjectKey(sha256: string): string {
  if (!isSha256Hex(sha256)) {
    throw new Error('对象 sha256 必须是 64 位小写十六进制');
  }
  return `obj/${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}`;
}

/** 从内容寻址对象键解析回 sha256；非法键返回 null。 */
export function sha256FromObjectKey(objectKey: string): string | null {
  const last = objectKey.split('/').pop();
  return last && isSha256Hex(last) ? last : null;
}

export function assertSafeObjectKey(objectKey: string): void {
  if (typeof objectKey !== 'string' || objectKey.length === 0) {
    throw new Error('对象键不能为空');
  }
  if (objectKey[0] === '/') {
    throw new Error('对象键不能为绝对路径');
  }
  if (objectKey.includes('\\')) {
    throw new Error('对象键不能包含反斜杠');
  }
  if (DRIVE_OR_SCHEME_RE.test(objectKey)) {
    throw new Error('对象键不能包含盘符或协议');
  }
  if (CONTROL_CHAR_RE.test(objectKey)) {
    throw new Error('对象键不能包含控制字符');
  }
  const segments = objectKey.split('/');
  for (const seg of segments) {
    if (seg.length === 0) throw new Error('对象键不能包含空段');
    if (seg === '.' || seg === '..') throw new Error('对象键不能包含点段');
  }
}

export function resolveObjectPath(rootDir: string, objectKey: string): string {
  assertSafeObjectKey(objectKey);
  const full = resolvePath(rootDir, objectKey);
  const root = resolvePath(rootDir);
  const prefix = root.endsWith(sep) ? root : root + sep;
  if (full !== root && !full.startsWith(prefix)) {
    throw new Error('对象键越出对象存储根目录');
  }
  return full;
}
