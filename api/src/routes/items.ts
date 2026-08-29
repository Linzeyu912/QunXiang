import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ItemRepository, prisma, parseReviewBucket, EntityReviewRepository } from '@qunxiang/storage';
import { itemUpdateSchema } from '@qunxiang/schemas';
import { loadOwnedBook, resolveOwnerId } from '../lib/authz.js';
import { sendServerError } from '../lib/send-error.js';
import { sendBookNotFound } from '../lib/api-errors.js';
import { isEnrichmentAvailable, requestEntityEnrichment } from '../services/entity-enrichment.service.js';

// 合法道具大类（与 schemas itemCategorySchema 保持一致）
const VALID_ITEM_CATEGORIES = new Set(['weapon', 'skill', 'food', 'pill', 'treasure', 'electronics', 'document', 'other']);

export async function itemRoutes(fastify: FastifyInstance) {
  // Get items (optionally filtered by review bucket / status / tier / category)
  fastify.get('/', async (request, reply) => {
    const { bookId, status, tier, category, reviewBucket, confidence, cursor, limit } = request.query as {
      bookId?: string; status?: string; tier?: string; category?: string; reviewBucket?: string; confidence?: string; cursor?: string; limit?: string;
    };

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

    if (category && !VALID_ITEM_CATEGORIES.has(category)) {
      return reply.status(400).send({ error: 'category 必须为 weapon、skill、food、pill、treasure、electronics、document 或 other' });
    }

    // reviewBucket=MAIN|LOW_CONFIDENCE|REJECTED；confidence=low 保留为兼容别名。
    const bucket = parseReviewBucket({ reviewBucket, confidence });
    if (!bucket) {
      return reply.status(400).send({ error: 'reviewBucket 必须为 MAIN、LOW_CONFIDENCE 或 REJECTED' });
    }

    const parsedLimit = limit ? Math.min(Math.max(Number(limit) || 0, 1), 500) : undefined;
    const [{ items, total, nextCursor }, counts] = await Promise.all([
      ItemRepository.findByReviewBucket({ bookId, ownerId: ownerId!, bucket, status, tier, category, cursor, limit: parsedLimit }),
      ItemRepository.countReviewBuckets(bookId, ownerId!),
    ]);

    return { items, total, nextCursor, counts };
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
      const rawBody = (request.body ?? {}) as Record<string, unknown>;
      const body = itemUpdateSchema.parse(rawBody);
      const expectedVersion = typeof rawBody.expectedVersion === 'number' ? rawBody.expectedVersion : undefined;

      const ownerId = await resolveOwnerId(request);
      const item = ownerId ? await ItemRepository.findOwnedById(id, ownerId) : null;
      if (!item) {
        return sendBookNotFound(reply);
      }
      // 乐观锁（实施包 E2）：版本冲突返回 409
      if (expectedVersion !== undefined && (item.version ?? 1) !== expectedVersion) {
        return reply.status(409).send({ error: '该实体已被其他操作修改，请刷新后重试' });
      }

      const updated = await ItemRepository.updateOwned(id, ownerId!, body);
      if (!updated) return sendBookNotFound(reply);

      // 人工审核动作：标记 USER 来源、版本 +1，并写统一审核历史
      const isReviewAction = body.status === 'APPROVED' || body.status === 'REJECTED';
      if (isReviewAction) {
        await prisma.item.updateMany({
          where: { id },
          data: { reviewSource: 'USER', version: { increment: 1 } },
        });
        await EntityReviewRepository.create({
          bookId: item.bookId,
          entityType: 'item',
          entityId: id,
          entityName: item.name,
          actorId: request.user.userId,
          actorType: 'USER',
          action: body.status === 'APPROVED' ? 'APPROVE' : 'REJECT',
          beforeValue: { status: item.status },
          afterValue: { status: body.status },
          changedFields: ['status'],
        });
      }
      const enrichmentAvailable = body.status === 'APPROVED' && isEnrichmentAvailable(updated);
      return { item: updated, enrichmentAvailable };
    } catch (err) {
      return sendServerError(reply, err, request.log);
    }
  });
  // 人工通过后的独立补写（实施包 A3）：入队后台任务，失败不影响已通过的实体
  fastify.post('/:id/enrichment', async (request, reply) => {
    const { id } = request.params as { id: string };
    const ownerId = await resolveOwnerId(request);
    if (!ownerId) return reply.status(401).send({ error: '请先登录' });
    const entity = await ItemRepository.findOwnedById(id, ownerId);
    if (!entity) return sendBookNotFound(reply);
    if (entity.status !== 'APPROVED') {
      return reply.status(409).send({ error: '仅人工通过的实体可以补写' });
    }
    try {
      const jobId = await requestEntityEnrichment({
        bookId: entity.bookId,
        ownerId,
        entityType: 'item',
        entityId: id,
        actorId: request.user.userId,
      });
      return { queued: true, jobId };
    } catch (err) {
      return sendServerError(reply, err, request.log);
    }
  });

}
