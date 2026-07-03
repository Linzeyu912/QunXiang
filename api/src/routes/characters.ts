import type { FastifyInstance, FastifyRequest } from 'fastify';
import { CharacterRepository, ReviewRepository, UserRepository } from '@novel-agent/storage';
import { characterUpdateSchema } from '@novel-agent/schemas';

function getEffectiveUserId(request: FastifyRequest): string {
  // 鉴权已由全局 onRequest 钩子强制，request.user 即权威身份。
  return request.user.userId;
}

export async function charactersRoutes(fastify: FastifyInstance) {
  // Get characters (optionally filtered by status)
  fastify.get('/', async (request, reply) => {
    const { bookId, status } = request.query as { bookId?: string; status?: string };

    if (!bookId) {
      return reply.status(400).send({ error: 'bookId is required' });
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
      const effectiveUserId = getEffectiveUserId(request);
      const user = await UserRepository.findOrCreate({
        email: `${effectiveUserId}@example.com`,
        name: effectiveUserId,
      });

      const updated: string[] = [];
      const skipped: { id: string; reason: string }[] = [];
      for (const id of ids) {
        const character = await CharacterRepository.findById(id);
        if (!character) {
          skipped.push({ id, reason: '不存在' });
          continue;
        }
        await ReviewRepository.create({
          characterId: id,
          userId: user.id,
          action: status,
          previousValue: character.status,
          newValue: status,
        });
        await CharacterRepository.updateStatus(id, status);
        updated.push(id);
      }
      return { updated, skipped };
    } catch (err) {
      request.log.error(err);
      const message = err instanceof Error ? err.message : 'Batch update failed';
      return reply.status(500).send({ error: message });
    }
  });

  // Update character (approve/reject/edit)
  fastify.patch('/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };

      // Resolve to a real User UUID (same pattern as books.ts)
      const effectiveUserId = getEffectiveUserId(request);
      const user = await UserRepository.findOrCreate({
        email: `${effectiveUserId}@example.com`,
        name: effectiveUserId,
      });

      const body = characterUpdateSchema.parse(request.body);

      const character = await CharacterRepository.findById(id);
      if (!character) {
        return reply.status(404).send({ error: 'Character not found' });
      }

      // Record review action (semantically distinct from character status)
      const validActions = ['APPROVED', 'REJECTED'] as const;
      const isReviewAction = (v: unknown): v is typeof validActions[number] =>
        typeof v === 'string' && (validActions as readonly string[]).includes(v);

      if (isReviewAction(body.status)) {
        await ReviewRepository.create({
          characterId: id,
          userId: user.id, // Use real UUID, not raw header string
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
      const message = err instanceof Error ? err.message : 'Update failed';
      return reply.status(500).send({ error: message });
    }
  });

  // Get character reviews
  fastify.get('/:id/reviews', async (request, reply) => {
    const { id } = request.params as { id: string };
    const reviews = await ReviewRepository.findByCharacterId(id);
    return { reviews };
  });
}