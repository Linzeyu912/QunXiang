import crypto from 'crypto';

/**
 * 纯 Node crypto 实现的 scrypt 口令哈希，避免引入 bcrypt 原生依赖。
 * 存储格式：scrypt$<saltHex>$<hashHex>。
 * 用异步 crypto.scrypt（而非 scryptSync），避免在登录/注册时阻塞 Fastify 事件循环。
 */
const KEY_LEN = 64;

function scryptAsync(plain: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(plain, salt, KEY_LEN, (err, derived) => {
      if (err) reject(err);
      else resolve(derived);
    });
  });
}

export async function hashPassword(plain: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scryptAsync(plain, salt);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export async function verifyPassword(
  plain: string,
  stored: string | null | undefined,
): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  if (expected.length !== KEY_LEN) return false;
  const computed = await scryptAsync(plain, salt);
  return crypto.timingSafeEqual(expected, computed);
}
