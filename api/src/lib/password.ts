import crypto from 'crypto';

/**
 * 纯 Node crypto 实现的 scrypt 口令哈希，避免引入 bcrypt 原生依赖。
 * 存储格式：scrypt$<saltHex>$<hashHex>。
 */
const KEY_LEN = 64;

export function hashPassword(plain: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(plain, salt, KEY_LEN);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(plain: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  if (expected.length !== KEY_LEN) return false;
  const computed = crypto.scryptSync(plain, salt, KEY_LEN);
  return crypto.timingSafeEqual(expected, computed);
}
