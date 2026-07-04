import type { FastifyRequest } from 'fastify';
import { BookRepository } from '@novel-agent/storage';

type BookRow = NonNullable<Awaited<ReturnType<typeof BookRepository.findById>>>;

/**
 * 当前请求的拥有者 id。
 * 书籍/实体/审核直接挂在真实 user.id（= JWT 的 userId）上——
 * 影子用户桥接已在 H1 下线（见 storage/scripts/migrate-owners.mjs）。
 */
export async function resolveOwnerId(request: FastifyRequest): Promise<string | null> {
  return request.user?.userId ?? null;
}

/**
 * 加载并校验 book 归属。
 * 不存在或不属于当前用户一律返回 null——调用方统一回 404，
 * 避免"无权"和"不存在"的响应差异泄露资源是否存在。
 */
export async function loadOwnedBook(
  bookId: string,
  ownerId: string | null,
): Promise<BookRow | null> {
  if (!ownerId) return null;
  const book = await BookRepository.findById(bookId);
  if (!book || book.userId !== ownerId) return null;
  return book;
}

/** 便捷布尔形式，用于列表/批量等只需判断归属的场景。 */
export async function ownsBook(
  bookId: string,
  ownerId: string | null,
): Promise<boolean> {
  return (await loadOwnedBook(bookId, ownerId)) !== null;
}
