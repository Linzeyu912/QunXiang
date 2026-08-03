import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export function shareCodeHash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function createShareCode(): { plain: string; hash: string } {
  const plain = randomBytes(32).toString('base64url');
  return { plain, hash: shareCodeHash(plain) };
}

export function verifyShareCode(plain: string, expectedHex: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(expectedHex)) return false;
  const actual = Buffer.from(shareCodeHash(plain), 'hex');
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
