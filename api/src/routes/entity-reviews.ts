/**
 * 统一审核历史路由（实施包 E1）。
 *
 *   GET /books/:bookId/entity-reviews           按书查询（可按实体类型/ID过滤）
 *   GET /books/:bookId/entity-reviews/summary   审核统计（各类别最近动作计数）
 *
 * 旧 GET /characters/:id/reviews 保留一个兼容周期（CharacterReview 双写中）。
 */
import type { FastifyInstance } from 'fastify';
import { EntityReviewRepository } from '@qunxiang/storage';
import { ownsBook, resolveOwnerId } from '../lib/authz.js';
import { sendBookNotFound } from '../lib/api-errors.js';
import { sendServerError } from '../lib/send-error.js';

export async function entityReviewRoutes(fastify: FastifyInstance) {
  fastify.get('/:bookId/entity-reviews', async (request, reply) => {
    const { bookId } = request.params as { bookId: string };
    const { entityType, entityId, limit } = request.query as {
      entityType?: string; entityId?: string; limit?: string;
    };
    const ownerId = await resolveOwnerId(request);
    if (!(await ownsBook(bookId, ownerId))) return sendBookNotFound(reply);
    try {
      let reviews;
      if (entityType && entityId) {
        reviews = await EntityReviewRepository.findByEntity(bookId, entityType, entityId);
      } else {
        const parsedLimit = limit ? Math.min(Math.max(Number(limit) || 0, 1), 500) : 200;
        reviews = await EntityReviewRepository.findByBook(bookId, parsedLimit);
      }
      return { reviews };
    } catch (err) {
      return sendServerError(reply, err, request.log);
    }
  });

  fastify.get('/:bookId/entity-reviews/summary', async (request, reply) => {
    const { bookId } = request.params as { bookId: string };
    const ownerId = await resolveOwnerId(request);
    if (!(await ownsBook(bookId, ownerId))) return sendBookNotFound(reply);
    try {
      const reviews = await EntityReviewRepository.findByBook(bookId, 500) as Array<{
        entityType: string; action: string; actorType: string;
      }>;
      const byAction: Record<string, number> = {};
      const byEntityType: Record<string, number> = {};
      for (const r of reviews) {
        byAction[r.action] = (byAction[r.action] ?? 0) + 1;
        byEntityType[r.entityType] = (byEntityType[r.entityType] ?? 0) + 1;
      }
      return { total: reviews.length, byAction, byEntityType };
    } catch (err) {
      return sendServerError(reply, err, request.log);
    }
  });
}
