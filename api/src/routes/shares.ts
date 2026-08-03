import type { FastifyInstance } from 'fastify';
import { loadOwnedBook, resolveOwnerId } from '../lib/authz.js';
import { sendBookNotFound } from '../lib/api-errors.js';
import { sendServerError } from '../lib/send-error.js';
import { createShare, listSharedWithMe, requestCopy, revokeShare, ShareCopyError, ShareError } from '../services/share.service.js';

/**
 * 分享路由（阶段三 D2）。注册到根（无前缀），路径含 /books/:id/shares 与 /shares/...。
 * 所有者操作先 loadOwnedBook；不存在/无权统一中文 404；分享失败统一 400 固定中文。
 */
export async function sharesRoutes(fastify: FastifyInstance) {
  // 所有者创建分享
  fastify.post('/books/:id/shares', async (request, reply) => {
    const { id } = request.params as { id: string };
    const ownerId = await resolveOwnerId(request);
    const book = await loadOwnedBook(id, ownerId);
    if (!book) return sendBookNotFound(reply);

    const body = (request.body ?? {}) as { recipientEmail?: string; recipientShareCode?: string };
    try {
      const share = await createShare(book, ownerId!, {
        recipientEmail: body.recipientEmail ?? '',
        recipientShareCode: body.recipientShareCode ?? '',
      });
      return { share: { id: share.id, status: share.status } };
    } catch (err) {
      if (err instanceof ShareError) {
        return reply.status(400).send({ code: 'SHARE_FAILED', error: err.message });
      }
      const msg = err instanceof Error ? err.message : String(err);
      if (/尚无可分享/.test(msg)) {
        return reply.status(409).send({ code: 'NO_READY_SNAPSHOT', error: msg });
      }
      return sendServerError(reply, err, request.log);
    }
  });

  // 接收方查看“分享给我”
  fastify.get('/shares/shared-with-me', async (request) => {
    const ownerId = await resolveOwnerId(request);
    const shares = await listSharedWithMe(ownerId!);
    return { shares };
  });

  // 发送者撤销分享
  fastify.post('/shares/:id/revoke', async (request, reply) => {
    const { id } = request.params as { id: string };
    const ownerId = await resolveOwnerId(request);
    const ok = await revokeShare(id, ownerId!);
    if (!ok) {
      return reply.status(404).send({ code: 'SHARE_NOT_FOUND', error: '分享不存在或已撤销' });
    }
    return { success: true };
  });

  // 接收方复制分享到自己的书库（E1c）
  fastify.post('/shares/:id/copy', async (request, reply) => {
    const { id } = request.params as { id: string };
    const ownerId = await resolveOwnerId(request);
    if (!ownerId) {
      return reply.status(401).send({ code: 'AUTH_REQUIRED', error: '请先登录' });
    }
    try {
      const result = await requestCopy(id, ownerId);
      return result;
    } catch (err) {
      if (err instanceof ShareCopyError) {
        return reply.status(404).send({ code: 'SHARE_NOT_FOUND', error: err.message });
      }
      if (err instanceof ShareError) {
        return reply.status(400).send({ code: 'SHARE_FAILED', error: err.message });
      }
      return sendServerError(reply, err, request.log);
    }
  });
}
