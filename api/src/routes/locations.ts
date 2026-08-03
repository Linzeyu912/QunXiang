import type { FastifyInstance, FastifyRequest } from 'fastify';
import { LocationRepository, prisma } from '@novel-agent/storage';
import { locationUpdateSchema } from '@novel-agent/schemas';
import { loadOwnedBook, resolveOwnerId } from '../lib/authz.js';
import { sendServerError } from '../lib/send-error.js';
import { sendBookNotFound } from '../lib/api-errors.js';

export async function locationRoutes(fastify: FastifyInstance) {
  // Get locations (optionally filtered by status or tier)
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

    let locations;
    if (tier) {
      locations = await LocationRepository.findByOwnedTier(bookId, ownerId!, tier);
    } else if (status) {
      locations = await LocationRepository.findByOwnedStatus(bookId, ownerId!, status);
    } else {
      locations = await LocationRepository.findByOwnedBookId(bookId, ownerId!);
    }

    return { locations };
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
    const locations = await prisma.location.findMany({
      where: { id: { in: ids }, book: { userId: ownerId } },
      select: { id: true, bookId: true },
    });
    const updated: string[] = [];
    const skipped: { id: string; reason: string }[] = [];
    const validIds: string[] = [];
    for (const loc of locations) {
      validIds.push(loc.id);
      updated.push(loc.id);
    }
    // ids 中不在 DB 的（不存在/无权）记为 skipped
    const foundIds = new Set(locations.map((l) => l.id));
    for (const id of ids) {
      if (!foundIds.has(id)) skipped.push({ id, reason: '不存在' });
    }
    if (validIds.length > 0) {
      await prisma.location.updateMany({
        where: { id: { in: validIds } },
        data: { status },
      });
    }
    return { updated, skipped };
  });

  // Update location (approve/reject/edit)
  fastify.patch('/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = locationUpdateSchema.parse(request.body);

      const ownerId = await resolveOwnerId(request);
      const location = ownerId ? await LocationRepository.findOwnedById(id, ownerId) : null;
      if (!location) {
        return sendBookNotFound(reply);
      }

      const updated = await LocationRepository.updateOwned(id, ownerId!, body);
      if (!updated) return sendBookNotFound(reply);
      return { location: updated };
    } catch (err) {
      return sendServerError(reply, err, request.log);
    }
  });
}
