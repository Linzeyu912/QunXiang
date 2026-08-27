import type { FastifyInstance } from 'fastify';
import { CharacterRepository, ReviewRepository, prisma, EntityReviewRepository } from '@qunxiang/storage';
import { characterUpdateSchema } from '@qunxiang/schemas';
import { loadOwnedBook, resolveOwnerId } from '../lib/authz.js';
import { sendServerError } from '../lib/send-error.js';
import { sendBookNotFound } from '../lib/api-errors.js';
import { parseReviewBucket } from '@qunxiang/storage';
import { findActiveMergeCandidates, judgeMergeCandidates, buildMergePreview } from '../services/character-merge.service.js';
import { isEnrichmentAvailable, requestEntityEnrichment } from '../services/entity-enrichment.service.js';

export async function charactersRoutes(fastify: FastifyInstance) {
  fastify.get('/merge-candidates', async (request, reply) => {
    const { bookId } = request.query as { bookId?: string };
    if (!bookId) return reply.status(400).send({ error: '缺少 bookId 参数' });
    const ownerId = await resolveOwnerId(request);
    if (!(await loadOwnedBook(bookId, ownerId))) return sendBookNotFound(reply);
    const { candidates, suggestions } = await findActiveMergeCandidates(bookId, ownerId!);
    return { candidates, suggestions };
  });

  // 合并字段预览：展示将保留与合并的字段，不执行合并（实施包 A4）
  fastify.get('/merge-candidates/preview', async (request, reply) => {
    const { primaryId, secondaryId } = request.query as { primaryId?: string; secondaryId?: string };
    if (!primaryId || !secondaryId) return reply.status(400).send({ error: '缺少 primaryId 或 secondaryId 参数' });
    const ownerId = await resolveOwnerId(request);
    if (!ownerId) return reply.status(401).send({ error: '请先登录' });
    const preview = await buildMergePreview(primaryId, secondaryId, ownerId);
    if (!preview) return sendBookNotFound(reply);
    return { preview };
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
    const { secondaryId, expectedVersion } = (request.body ?? {}) as { secondaryId?: string; expectedVersion?: number };
    if (!secondaryId) return reply.status(400).send({ error: 'secondaryId 为必填项' });
    const ownerId = await resolveOwnerId(request);
    const primary = ownerId ? await CharacterRepository.findOwnedById(primaryId, ownerId) : null;
    if (!primary) return sendBookNotFound(reply);
    // 乐观锁：调用方传入的版本与当前不一致时拒绝，要求刷新后重试
    if (typeof expectedVersion === 'number' && (primary.version ?? 1) !== expectedVersion) {
      return reply.status(409).send({ error: '角色已被其他操作修改，请刷新后重试' });
    }
    const candidates = await findActiveMergeCandidates(primary.bookId, ownerId!);
    if (!candidates.candidates.some((candidate) => candidate.primaryId === primaryId && candidate.secondaryId === secondaryId)) {
      return reply.status(409).send({ error: '该角色对不是待审核的疑似重复项' });
    }
    const character = await CharacterRepository.mergeOwned(primaryId, secondaryId, ownerId!, request.user.userId);
    if (!character) return sendBookNotFound(reply);
    // 人工确认合并写入统一审核历史（模型建议不会落 USER 记录）
    await EntityReviewRepository.create({
      bookId: primary.bookId,
      entityType: 'character',
      entityId: primaryId,
      entityName: primary.name,
      actorId: request.user.userId,
      actorType: 'USER',
      action: 'MERGE_ACCEPTED',
      afterValue: { primaryId, secondaryId },
      changedFields: [],
    });
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
    if (!candidates.candidates.some((candidate) => candidate.primaryId === primaryId && candidate.secondaryId === secondaryId)) {
      return reply.status(409).send({ error: '该角色对不是待审核的疑似重复项' });
    }
    if (!(await CharacterRepository.rejectMergeOwned(primaryId, secondaryId, ownerId!, request.user.userId))) {
      return reply.status(409).send({ error: '该角色对不是待审核的疑似重复项' });
    }
    await EntityReviewRepository.create({
      bookId: primary.bookId,
      entityType: 'character',
      entityId: primaryId,
      entityName: primary.name,
      actorId: request.user.userId,
      actorType: 'USER',
      action: 'MERGE_REJECTED',
      afterValue: { primaryId, secondaryId },
      changedFields: [],
    });
    return { ok: true };
  });

  // Get characters (optionally filtered by review bucket / status)
  fastify.get('/', async (request, reply) => {
    const { bookId, status, reviewBucket, confidence, cursor, limit } = request.query as {
      bookId?: string; status?: string; reviewBucket?: string; confidence?: string; cursor?: string; limit?: string;
    };

    if (!bookId) {
      return reply.status(400).send({ error: '缺少 bookId 参数' });
    }

    // 不存在和越权返回完全相同的响应，避免泄露资源存在性。
    const ownerId = await resolveOwnerId(request);
    if (!(await loadOwnedBook(bookId, ownerId))) {
      return sendBookNotFound(reply);
    }

    // reviewBucket=MAIN|LOW_CONFIDENCE|REJECTED；confidence=low 保留为兼容别名。
    const bucket = parseReviewBucket({ reviewBucket, confidence });
    if (!bucket) {
      return reply.status(400).send({ error: 'reviewBucket 必须为 MAIN、LOW_CONFIDENCE 或 REJECTED' });
    }

    const parsedLimit = limit ? Math.min(Math.max(Number(limit) || 0, 1), 500) : undefined;
    const [{ characters, total, nextCursor }, counts] = await Promise.all([
      CharacterRepository.findByReviewBucket({ bookId, ownerId: ownerId!, bucket, status, cursor, limit: parsedLimit }),
      CharacterRepository.countReviewBuckets(bookId, ownerId!),
    ]);

    return { characters, total, nextCursor, counts };
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
      const { expectedVersion } = (request.body ?? {}) as { expectedVersion?: number };

      const ownerId = await resolveOwnerId(request);
      const character = ownerId ? await CharacterRepository.findOwnedById(id, ownerId) : null;
      if (!character) {
        return sendBookNotFound(reply);
      }
      // 乐观锁（实施包 E2）：调用方版本与当前不一致时拒绝，要求刷新后重试
      if (typeof expectedVersion === 'number' && (character.version ?? 1) !== expectedVersion) {
        return reply.status(409).send({ error: '该实体已被其他操作修改，请刷新后重试' });
      }

      // Record review action (semantically distinct from character status)
      const validActions = ['APPROVED', 'REJECTED'] as const;
      const isReviewAction = (v: unknown): v is typeof validActions[number] =>
        typeof v === 'string' && (validActions as readonly string[]).includes(v);

      if (isReviewAction(body.status)) {
        // 旧角色审核表双写（兼容周期）；统一审核记录见下方 EntityReview
        await ReviewRepository.create({
          characterId: id,
          userId: request.user.userId,
          action: body.status,
          previousValue: character.status,
          newValue: body.status,
        });
      }

      // Update character
      let updated = await CharacterRepository.updateOwned(id, ownerId!, body);
      if (!updated) return sendBookNotFound(reply);

      // 人工审核动作：标记 USER 来源、版本 +1，并写统一审核历史
      if (isReviewAction(body.status)) {
        await prisma.character.updateMany({
          where: { id },
          data: { reviewSource: 'USER', version: { increment: 1 } },
        });
        updated = { ...updated, reviewSource: 'USER', version: (updated.version ?? 1) + 1 };
        await EntityReviewRepository.create({
          bookId: character.bookId,
          entityType: 'character',
          entityId: id,
          entityName: character.name,
          actorId: request.user.userId,
          actorType: 'USER',
          action: body.status === 'APPROVED' ? 'APPROVE' : 'REJECT',
          beforeValue: { status: character.status },
          afterValue: { status: body.status },
          changedFields: ['status'],
        });
      }

      // 低置信度实体人工通过后提示可补写（描述缺失或过短）
      const enrichmentAvailable = body.status === 'APPROVED' && isEnrichmentAvailable(updated);
      return { character: updated, enrichmentAvailable };
    } catch (err) {
      return sendServerError(reply, err, request.log);
    }
  });

  // 低置信度人工通过后的独立补写（实施包 A3）：入队后台任务，失败不影响已通过的实体
  fastify.post('/:id/enrichment', async (request, reply) => {
    const { id } = request.params as { id: string };
    const ownerId = await resolveOwnerId(request);
    if (!ownerId) return reply.status(401).send({ error: '请先登录' });
    const character = await CharacterRepository.findOwnedById(id, ownerId);
    if (!character) return sendBookNotFound(reply);
    if (character.status !== 'APPROVED') {
      return reply.status(409).send({ error: '仅人工通过的实体可以补写' });
    }
    try {
      const jobId = await requestEntityEnrichment({
        bookId: character.bookId,
        ownerId,
        entityType: 'character',
        entityId: id,
        actorId: request.user.userId,
      });
      return { queued: true, jobId };
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
