import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ItemRepository } from '@novel-agent/storage';
import { itemUpdateSchema } from '@novel-agent/schemas';

export async function itemRoutes(fastify: FastifyInstance) {
  // Get items (optionally filtered by status or tier)
  fastify.get('/', async (request, reply) => {
    const { bookId, status, tier } = request.query as { bookId?: string; status?: string; tier?: string };

    if (!bookId) {
      return reply.status(400).send({ error: 'bookId is required' });
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

    const updated: string[] = [];
    const skipped: { id: string; reason: string }[] = [];
    for (const id of ids) {
      const item = await ItemRepository.findById(id);
      if (!item) {
        skipped.push({ id, reason: '不存在' });
        continue;
      }
      await ItemRepository.updateStatus(id, status);
      updated.push(id);
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

      const updated = await ItemRepository.update(id, body);
      return { item: updated };
    } catch (err) {
      request.log.error(err);
      const message = err instanceof Error ? err.message : 'Update failed';
      return reply.status(500).send({ error: message });
    }
  });
}
