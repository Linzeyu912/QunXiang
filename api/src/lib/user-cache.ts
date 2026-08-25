/**
 * 请求鉴权用户校验缓存。
 *
 * 受保护请求都会按 JWT 中的 userId 校验账号是否仍有效。短时内存缓存可避免
 * SSE 和轮询请求反复查询用户表；只缓存存在的用户，默认 15 秒后过期。
 */
import { UserRepository } from '@qunxiang/storage';
import type { User } from '@qunxiang/core';

const USER_CACHE_TTL_MS = Number(process.env.AUTH_USER_CACHE_TTL_MS) > 0
  ? Number(process.env.AUTH_USER_CACHE_TTL_MS)
  : 15_000;
const MAX_ENTRIES = 512;

interface CacheEntry {
  user: User;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

/** 带短时缓存的用户查询；未命中或已过期时回源数据库。 */
export async function findUserCached(userId: string): Promise<User | null> {
  const now = Date.now();
  const hit = cache.get(userId);
  if (hit && hit.expiresAt > now) return hit.user;

  const user = await UserRepository.findById(userId);
  if (user) {
    cache.set(userId, { user, expiresAt: now + USER_CACHE_TTL_MS });
    if (cache.size > MAX_ENTRIES) {
      for (const [key, entry] of cache) {
        if (entry.expiresAt <= now) cache.delete(key);
      }
    }
  } else if (hit) {
    cache.delete(userId);
  }
  return user;
}

/** 账号状态变化后可主动失效单个用户或全部缓存。 */
export function invalidateUserCache(userId?: string): void {
  if (userId) cache.delete(userId);
  else cache.clear();
}
