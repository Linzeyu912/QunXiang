import type { FastifyInstance } from 'fastify';
import { CharacterRepository, ReviewRepository, prisma } from '@novel-agent/storage';
import { characterUpdateSchema } from '@novel-agent/schemas';
import { ownsBook, resolveOwnerId } from '../lib/authz.js';

export async function charactersRoutes(fastify: FastifyInstance) {
  // Get characters (optionally filtered by status)
  fastify.get('/', async (request, reply) => {
    const { bookId, status } = request.query as { bookId?: string; status?: string };

    if (!bookId) {
      return reply.status(400).send({ error: 'bookId is required' });
    }

    // 越权防护：不是当前用户名下的书，返回空列表（不泄露存在性）
    const ownerId = await resolveOwnerId(request);
    if (!(await ownsBook(bookId, ownerId))) {
      return { characters: [] };
    }

    let characters;
    if (status) {
      characters = await CharacterRepository.findByStatus(bookId, status);
    } else {
      characters = await CharacterRepository.findByBookId(bookId);
    }

    return { characters };
  });

  // 批量改状态（审核通过/拒绝）。逐条记录 CharacterReview，与单条 PATCH 语义一致。
  fastify.post('/batch', async (request, reply) => {
    const { ids, status } = request.body as { ids?: string[]; status?: string };
    if (!Array.isArray(ids) || ids.length === 0) {
      return reply.status(400).send({ error: 'ids is required' });
    }
    if (status !== 'APPROVED' && status !== 'REJECTED') {
      return reply.status(400).send({ error: 'status must be APPROVED or REJECTED' });
    }

    try {
      const userId = request.user.userId;
      const ownerId = await resolveOwnerId(request);

      // 一次 findMany 取回所有实体（替代逐条 findById 的 N+1 查询），
      // 再批量校验归属。整个审核写入用事务包裹，中途失败则全部回滚（原子性）。
      const characters = await prisma.character.findMany({
        where: { id: { in: ids } },
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
        // 归属校验：批量查一次所有相关 book 的 owner
        if (!(await ownsBook(character.bookId, ownerId))) {
          skipped.push({ id, reason: '不存在' }); // 统一按不存在跳过，避免泄露
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
      request.log.error(err);
      return reply.status(500).send({ error: '内部错误，请查看服务端日志' });
    }
  });

  // Update character (approve/reject/edit)
  fastify.patch('/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };

      const body = characterUpdateSchema.parse(request.body);

      const character = await CharacterRepository.findById(id);
      if (!character) {
        return reply.status(404).send({ error: 'Character not found' });
      }
      const ownerId = await resolveOwnerId(request);
      if (!(await ownsBook(character.bookId, ownerId))) {
        return reply.status(404).send({ error: 'Character not found' });
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
      const updated = await CharacterRepository.update(id, body);

      return { character: updated };
    } catch (err) {
      request.log.error(err);
      return reply.status(500).send({ error: '内部错误，请查看服务端日志' });
    }
  });

  // Get character reviews
  fastify.get('/:id/reviews', async (request, reply) => {
    const { id } = request.params as { id: string };
    const character = await CharacterRepository.findById(id);
    if (!character) {
      return reply.status(404).send({ error: 'Character not found' });
    }
    const ownerId = await resolveOwnerId(request);
    if (!(await ownsBook(character.bookId, ownerId))) {
      return reply.status(404).send({ error: 'Character not found' });
    }
    const reviews = await ReviewRepository.findByCharacterId(id);
    return { reviews };
  });
}