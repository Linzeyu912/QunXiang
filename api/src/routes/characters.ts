import type { FastifyInstance } from 'fastify';
import { CharacterRepository, ReviewRepository, prisma } from '@qunxiang/storage';
import { characterUpdateSchema } from '@qunxiang/schemas';
import { loadOwnedBook, resolveOwnerId } from '../lib/authz.js';
import { sendServerError } from '../lib/send-error.js';
import { sendBookNotFound } from '../lib/api-errors.js';
import { isLowConfidenceEntity } from '@qunxiang/core';
import { findActiveMergeCandidates, judgeMergeCandidates } from '../services/character-merge.service.js';

export async function charactersRoutes(fastify: FastifyInstance) {
  fastify.get('/merge-candidates', async (request, reply) => {
    const { bookId } = request.query as { bookId?: string };
    if (!bookId) return reply.status(400).send({ error: '缺少 bookId 参数' });
    const ownerId = await resolveOwnerId(request);
    if (!(await loadOwnedBook(bookId, ownerId))) return sendBookNotFound(reply);
    return { candidates: await findActiveMergeCandidates(bookId, ownerId!) };
  });

  fastify.post('/merge-candidates/llm-judge', {
    config: { rateLimit: { max: 3, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const body = (request.body ?? {}) as { bookId?: string };
    if (!body.bookId) return reply.status(400).send({ error: '缺少 bookId 参数' });
    const ownerId = await resolveOwnerId(request);
    if (!(await loadOwnedBook(body.bookId, ownerId))) return sendBookNotFound(reply);
    try {
      return await judgeMergeCandidates(body.bookId, ownerId!, request.user.userId);
    } catch (err) {
      return sendServerError(reply, err, request.log);
    }
  });

  fastify.post('/merge-candidates/:primaryId/accept', async (request, reply) => {
    const { primaryId } = request.params as { primaryId: string };
    const { secondaryId } = request.body as { secondaryId?: string };
    if (!secondaryId) return reply.status(400).send({ error: 'secondaryId 为必填项' });
    const ownerId = await resolveOwnerId(request);
    const primary = ownerId ? await CharacterRepository.findOwnedById(primaryId, ownerId) : null;
    if (!primary) return sendBookNotFound(reply);
    const candidates = await findActiveMergeCandidates(primary.bookId, ownerId!);
    if (!candidates.some((candidate) => candidate.primaryId === primaryId && candidate.secondaryId === secondaryId)) {
      return reply.status(409).send({ error: '该角色对不是待审核的疑似重复项' });
    }
    const character = await CharacterRepository.mergeOwned(primaryId, secondaryId, ownerId!, request.user.userId);
    if (!character) return sendBookNotFound(reply);
    return { character };
  });

  fastify.post('/merge-candidates/:primaryId/reject', async (request, reply) => {
    const { primaryId } = request.params as { primaryId: string };
    const { secondaryId } = request.body as { secondaryId?: string };
    if (!secondaryId) return reply.status(400).send({ error: 'secondaryId 为必填项' });
    const ownerId = await resolveOwnerId(request);
    const [primary, secondary] = ownerId ? await Promise.all([CharacterRepository.findOwnedById(primaryId, ownerId), CharacterRepository.findOwnedById(secondaryId, ownerId)]) : [null, null];
    if (!primary || !secondary || primary.bookId !== secondary.bookId) return sendBookNotFound(reply);
    const candidates = await findActiveMergeCandidates(primary.bookId, ownerId!);
    if (!candidates.some((candidate) => candidate.primaryId === primaryId && candidate.secondaryId === secondaryId)) {
      return reply.status(409).send({ error: '该角色对不是待审核的疑似重复项' });
    }
    if (!(await CharacterRepository.rejectMergeOwned(primaryId, secondaryId, ownerId!, request.user.userId))) {
      return reply.status(409).send({ error: '该角色对不是待审核的疑似重复项' });
    }
    return { ok: true };
  });

  // Get characters (optionally filtered by status or confidence)
  fastify.get('/', async (request, reply) => {
    const { bookId, status, confidence } = request.query as { bookId?: string; status?: string; confidence?: string };

    if (!bookId) {
      return reply.status(400).send({ error: '缺少 bookId 参数' });
    }

    // 不存在和越权返回完全相同的响应，避免泄露资源存在性。
    const ownerId = await resolveOwnerId(request);
    if (!(await loadOwnedBook(bookId, ownerId))) {
      return sendBookNotFound(reply);
    }

    let characters;
    if (status) {
      characters = await CharacterRepository.findByOwnedStatus(bookId, ownerId!, status);
    } else {
      characters = await CharacterRepository.findByOwnedBookId(bookId, ownerId!);
    }

    // 低置信度库：confidence=low 只取低置信度待审核实体；默认列表排除低置信度（APPROVED 不受影响）。
    characters = confidence === 'low'
      ? characters.filter((c) => isLowConfidenceEntity(c))
      : characters.filter((c) => !isLowConfidenceEntity(c));

    return { characters };
  });

  // 批量改状态（审核通过/拒绝）。逐条记录 CharacterReview，与单条 PATCH 语义一致。
  fastify.post('/batch', async (request, reply) => {
    const { ids, status } = request.body as { ids?: string[]; status?: string };
    if (!Array.isArray(ids) || ids.length === 0) {
      return reply.status(400).send({ error: 'ids 为必填项' });
    }
    if (status !== 'APPROVED' && status !== 'REJECTED') {
      return reply.status(400).send({ error: 'status 必须为 APPROVED 或 REJECTED' });
    }

    try {
      const userId = request.user.userId;
      const ownerId = await resolveOwnerId(request);
      if (!ownerId) {
        return reply.status(401).send({ error: '请先登录' });
      }

      // 一次 findMany 取回所有实体（替代逐条 findById 的 N+1 查询），
      // 再批量校验归属。整个审核写入用事务包裹，中途失败则全部回滚（原子性）。
      const characters = await prisma.character.findMany({
        where: { id: { in: ids }, book: { userId: ownerId } },
        select: { id: true, bookId: true, status: true },
      });
      const charById = new Map(characters.map((c) => [c.id, c]));

      const updated: string[] = [];
      const skipped: { id: string; reason: string }[] = [];
      const toUpdate: { id: string; previousValue: string }[] = [];

      for (const id of ids) {
        const character = charById.get(id);
        if (!character) {
          skipped.push({ id, reason: '不存在' });
          continue;
        }
        toUpdate.push({ id, previousValue: character.status });
      }

      // 事务：Review 记录 + 状态更新要么全成功要么全回滚
      if (toUpdate.length > 0) {
        await prisma.$transaction(async (tx) => {
          await tx.characterReview.createMany({
            data: toUpdate.map((c) => ({
              characterId: c.id,
              userId,
              action: status,
              previousValue: c.previousValue,
              newValue: status,
            })),
          });
          await tx.character.updateMany({
            where: { id: { in: toUpdate.map((c) => c.id) } },
            data: { status },
          });
        });
        for (const c of toUpdate) updated.push(c.id);
      }
      return { updated, skipped };
    } catch (err) {
      return sendServerError(reply, err, request.log);
    }
  });

  // Update character (approve/reject/edit)
  fastify.patch('/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };

      const body = characterUpdateSchema.parse(request.body);

      const ownerId = await resolveOwnerId(request);
      const character = ownerId ? await CharacterRepository.findOwnedById(id, ownerId) : null;
      if (!character) {
        return sendBookNotFound(reply);
      }

      // Record review action (semantically distinct from character status)
      const validActions = ['APPROVED', 'REJECTED'] as const;
      const isReviewAction = (v: unknown): v is typeof validActions[number] =>
        typeof v === 'string' && (validActions as readonly string[]).includes(v);

      if (isReviewAction(body.status)) {
        await ReviewRepository.create({
          characterId: id,
          userId: request.user.userId,
          action: body.status,
          previousValue: character.status,
          newValue: body.status,
        });
      }

      // Update character
      const updated = await CharacterRepository.updateOwned(id, ownerId!, body);
      if (!updated) return sendBookNotFound(reply);

      return { character: updated };
    } catch (err) {
      return sendServerError(reply, err, request.log);
    }
  });

  // Get character reviews
  fastify.get('/:id/reviews', async (request, reply) => {
    const { id } = request.params as { id: string };
    const ownerId = await resolveOwnerId(request);
    const character = ownerId ? await CharacterRepository.findOwnedById(id, ownerId) : null;
    if (!character) {
      return sendBookNotFound(reply);
    }
    const reviews = await ReviewRepository.findOwnedByCharacterId(id, ownerId!);
    return { reviews };
  });
}
