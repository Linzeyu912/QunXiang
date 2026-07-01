import type { FastifyInstance } from 'fastify';
import { startExtraction, pollExtractionStatus, getExtractionStages, createExtractionStream } from '../services/extraction.service.js';

export async function extractRoutes(fastify: FastifyInstance) {
  // Trigger extraction
  fastify.post('/:id/extract', async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = request.user!.userId;

    try {
      const { taskId } = await startExtraction(id, userId);
      return { taskId, message: 'Extraction started' };
    } catch (error) {
      return reply.status(500).send({ error: String(error) });
    }
  });

  // Poll extraction status
  fastify.get('/:id/extract/status', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { taskId } = request.query as { taskId?: string };

    if (!taskId) {
      return reply.status(400).send({ error: 'taskId is required' });
    }

    const status = await pollExtractionStatus(taskId);
    return status;
  });

  // Get extraction stages progress
  fastify.get('/:id/extract/stages', async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const stages = await getExtractionStages(id);
      return stages;
    } catch (error) {
      return reply.status(500).send({ error: String(error) });
    }
  });

  // SSE stream for real-time extraction progress
  fastify.get('/:id/extract/stream', async (request, reply) => {
    const { id: bookId } = request.params as { id: string };

    // Set SSE headers
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // Stream events
    try {
      for await (const chunk of createExtractionStream(bookId)) {
        reply.raw.write(chunk);
      }
    } catch (err) {
      console.error('[SSE] Stream error:', err);
      reply.raw.write(`event: error\ndata: ${JSON.stringify({ message: String(err), timestamp: Date.now() })}\n\n`);
    }

    reply.raw.end();
    return reply;
  });
}