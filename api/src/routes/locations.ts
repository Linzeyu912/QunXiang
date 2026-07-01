import type { FastifyInstance, FastifyRequest } from 'fastify';
import { LocationRepository } from '@novel-agent/storage';
import { locationUpdateSchema } from '@novel-agent/schemas';

export async function locationRoutes(fastify: FastifyInstance) {
  // Get locations (optionally filtered by status or tier)
  fastify.get('/', async (request, reply) => {
    const { bookId, status, tier } = request.query as { bookId?: string; status?: string; tier?: string };

    if (!bookId) {
      return reply.status(400).send({ error: 'bookId is required' });
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

  // Update location (approve/reject/edit)
  fastify.patch('/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = locationUpdateSchema.parse(request.body);

      const location = await LocationRepository.findById(id);
      if (!location) {
        return reply.status(404).send({ error: 'Location not found' });
      }

      const updated = await LocationRepository.update(id, body);
      return { location: updated };
    } catch (err) {
      request.log.error(err);
      const message = err instanceof Error ? err.message : 'Update failed';
      return reply.status(500).send({ error: message });
    }
  });
}
