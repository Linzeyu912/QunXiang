import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ItemRepository, prisma } from '@novel-agent/storage';
import { itemUpdateSchema } from '@novel-agent/schemas';
import { loadOwnedBook, resolveOwnerId } from '../lib/authz.js';
import { sendServerError } from '../lib/send-error.js';
import { sendBookNotFound } from '../lib/api-errors.js';

export async function itemRoutes(fastify: FastifyInstance) {
  // Get items (optionally filtered by status or tier)
  fastify.get('/', async (request, reply) => {
    const { bookId, status, tier } = request.query as { bookId?: string; status?: string; tier?: string };

    if (!bookId) {
      return reply.status(400).send({ error: '缺少 bookId 参数' });
    }

    const ownerId = await resolveOwnerId(request);
    if (!ownerId) {
      return reply.status(401).send({ error: '请先登录' });
    }
    if (!(await loadOwnedBook(bookId, ownerId))) {
      return sendBookNotFound(reply);
    }

    let items;
    if (tier) {
      items = await ItemRepository.findByOwnedTier(bookId, ownerId!, tier);
    } else if (status) {
      items = await ItemRepository.findByOwnedStatus(bookId, ownerId!, status);
    } else {
      items = await ItemRepository.findByOwnedBookId(bookId, ownerId!);
    }

    return { items };
  });

  // 批量改状态（审核通过/拒绝）。
  fastify.post('/batch', async (request, reply) => {
    const { ids, status } = request.body as { ids?: string[]; status?: string };
    if (!Array.isArray(ids) || ids.length === 0) {
      return reply.status(400).send({ error: 'ids 为必填项' });
    }
    if (status !== 'APPROVED' && status !== 'REJECTED') {
      return reply.status(400).send({ error: 'status 必须为 APPROVED 或 REJECTED' });
    }

    const ownerId = await resolveOwnerId(request);
    if (!ownerId) {
      return reply.status(401).send({ error: '请先登录' });
    }
    // 一次 findMany 取回所有实体（替代逐条 findById 的 N+1），批量校验归属后 updateMany。
    const items = await prisma.item.findMany({
      where: { id: { in: ids }, book: { userId: ownerId } },
      select: { id: true, bookId: true },
    });
    const updated: string[] = [];
    const skipped: { id: string; reason: string }[] = [];
    const validIds: string[] = [];
    for (const item of items) {
      validIds.push(item.id);
      updated.push(item.id);
    }
    const foundIds = new Set(items.map((i) => i.id));
    for (const id of ids) {
      if (!foundIds.has(id)) skipped.push({ id, reason: '不存在' });
    }
    if (validIds.length > 0) {
      await prisma.item.updateMany({
        where: { id: { in: validIds } },
        data: { status },
      });
    }
    return { updated, skipped };
  });

  // Update item (approve/reject/edit)
  fastify.patch('/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = itemUpdateSchema.parse(request.body);

      const ownerId = await resolveOwnerId(request);
      const item = ownerId ? await ItemRepository.findOwnedById(id, ownerId) : null;
      if (!item) {
        return sendBookNotFound(reply);
      }

      const updated = await ItemRepository.updateOwned(id, ownerId!, body);
      if (!updated) return sendBookNotFound(reply);
      return { item: updated };
    } catch (err) {
      return sendServerError(reply, err, request.log);
    }
  });
}
