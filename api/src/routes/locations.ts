import type { FastifyInstance, FastifyRequest } from 'fastify';
import { LocationRepository, prisma } from '@novel-agent/storage';
import { locationUpdateSchema } from '@novel-agent/schemas';
import { ownsBook, resolveOwnerId } from '../lib/authz.js';

export async function locationRoutes(fastify: FastifyInstance) {
  // Get locations (optionally filtered by status or tier)
  fastify.get('/', async (request, reply) => {
    const { bookId, status, tier } = request.query as { bookId?: string; status?: string; tier?: string };

    if (!bookId) {
      return reply.status(400).send({ error: 'bookId is required' });
    }

    const ownerId = await resolveOwnerId(request);
    if (!(await ownsBook(bookId, ownerId))) {
      return { locations: [] };
    }

    let locations;
    if (tier) {
      locations = await LocationRepository.findByTier(bookId, tier);
    } else if (status) {
      locations = await LocationRepository.findByStatus(bookId, status);
    } else {
      locations = await LocationRepository.findByBookId(bookId);
    }

    return { locations };
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
    const locations = await prisma.location.findMany({
      where: { id: { in: ids } },
      select: { id: true, bookId: true },
    });
    const updated: string[] = [];
    const skipped: { id: string; reason: string }[] = [];
    const validIds: string[] = [];
    for (const loc of locations) {
      if (!(await ownsBook(loc.bookId, ownerId))) {
        skipped.push({ id: loc.id, reason: '不存在' });
        continue;
      }
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

      const location = await LocationRepository.findById(id);
      if (!location) {
        return reply.status(404).send({ error: 'Location not found' });
      }
      const ownerId = await resolveOwnerId(request);
      if (!(await ownsBook(location.bookId, ownerId))) {
        return reply.status(404).send({ error: 'Location not found' });
      }

      const updated = await LocationRepository.update(id, body);
      return { location: updated };
    } catch (err) {
      request.log.error(err);
      return reply.status(500).send({ error: '内部错误，请查看服务端日志' });
    }
  });
}
