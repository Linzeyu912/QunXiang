import type { FastifyInstance, FastifyRequest } from 'fastify';
import { CharacterRepository, ReviewRepository, UserRepository } from '@novel-agent/storage';
import { characterUpdateSchema } from '@novel-agent/schemas';

function getEffectiveUserId(request: FastifyRequest): string {
  const xUserId = request.headers['x-user-id'];
  if (typeof xUserId === 'string' && xUserId) return xUserId;
  return request.user!.userId;
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