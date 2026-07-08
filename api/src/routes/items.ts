import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ItemRepository, prisma } from '@novel-agent/storage';
import { itemUpdateSchema } from '@novel-agent/schemas';
import { ownsBook, resolveOwnerId } from '../lib/authz.js';

export async function itemRoutes(fastify: FastifyInstance) {
  // Get items (optionally filtered by status or tier)
  fastify.get('/', async (request, reply) => {
    const { bookId, status, tier } = request.query as { bookId?: string; status?: string; tier?: string };

    if (!bookId) {
      return reply.status(400).send({ error: 'bookId is required' });
    }

    const ownerId = await resolveOwnerId(request);
    if (!(await ownsBook(bookId, ownerId))) {
      return { items: [] };
    }

    let items;
    if (tier) {
      items = await ItemRepository.findByTier(bookId, tier);
    } else if (status) {
      items = await ItemRepository.findByStatus(bookId, status);
    } else {
      items = await ItemRepository.findByBookId(bookId);
    }

    return { items };
  });

  // 批量改状态（审核通过/拒绝）。
  fastify.post('/batch', async (request, reply) => {
    const { ids, status } = request.body as { ids?: string[]; status?: string };
    if (!Array.isArray(ids) || ids.length === 0) {
      return reply.status(400).send({ error: 'ids is required' });
    }
    if (status !== 'APPROVED' && status !== 'REJECTED') {
      return reply.status(400).send({ error: 'status must be APPROVED or REJECTED' });
    }

    const ownerId = await resolveOwnerId(request);
    // 一次 findMany 取回所有实体（替代逐条 findById 的 N+1），批量校验归属后 updateMany。
    const items = await prisma.item.findMany({
      where: { id: { in: ids } },
      select: { id: true, bookId: true },
    });
    const updated: string[] = [];
    const skipped: { id: string; reason: string }[] = [];
    const validIds: string[] = [];
    for (const item of items) {
      if (!(await ownsBook(item.bookId, ownerId))) {
        skipped.push({ id: item.id, reason: '不存在' });
        continue;
      }
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

      const item = await ItemRepository.findById(id);
      if (!item) {
        return reply.status(404).send({ error: 'Item not found' });
      }
      const ownerId = await resolveOwnerId(request);
      if (!(await ownsBook(item.bookId, ownerId))) {
        return reply.status(404).send({ error: 'Item not found' });
      }

      const updated = await ItemRepository.update(id, body);
      return { item: updated };
    } catch (err) {
      request.log.error(err);
      return reply.status(500).send({ error: '内部错误，请查看服务端日志' });
    }
  });
}
