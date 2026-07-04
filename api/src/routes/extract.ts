import type { FastifyInstance } from 'fastify';
import { startExtraction, pollExtractionStatus, getExtractionStages, createExtractionStream } from '../services/extraction.service.js';
import { ownsBook, resolveOwnerId } from '../lib/authz.js';
import { ConflictError } from '../lib/errors.js';

export async function extractRoutes(fastify: FastifyInstance) {
  // Trigger extraction
  fastify.post('/:id/extract', async (request, reply) => {
    const { id } = request.params as { id: string };
    const ownerId = await resolveOwnerId(request);
    if (!(await ownsBook(id, ownerId))) {
      return reply.status(404).send({ error: 'Book not found' });
    }
    const userId = request.user!.userId;

    try {
      const { taskId } = await startExtraction(id, userId);
      return { taskId, message: 'Extraction started' };
    } catch (error) {
      if (error instanceof ConflictError) {
        return reply.status(409).send({ error: (error as Error).message });
      }
      request.log.error(error);
      return reply.status(500).send({ error: '提取触发失败，请查看服务端日志' });
    }
  });

  // Poll extraction status
  fastify.get('/:id/extract/status', async (request, reply) => {
    const { id } = request.params as { id: string };
    const ownerId = await resolveOwnerId(request);
    if (!(await ownsBook(id, ownerId))) {
      return reply.status(404).send({ error: 'Book not found' });
    }
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
    const ownerId = await resolveOwnerId(request);
    if (!(await ownsBook(id, ownerId))) {
      return reply.status(404).send({ error: 'Book not found' });
    }

    try {
      const stages = await getExtractionStages(id);
      return stages;
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: '获取提取进度失败' });
    }
  });

  // SSE stream for real-time extraction progress
  fastify.get('/:id/extract/stream', async (request, reply) => {
    const { id: bookId } = request.params as { id: string };

    // 鉴权+归属必须在写 SSE 头之前完成，否则即便返 404 浏览器也会把连接当 SSE 处理
    const ownerId = await resolveOwnerId(request);
    if (!(await ownsBook(bookId, ownerId))) {
      return reply.status(404).send({ error: 'Book not found' });
    }

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
      reply.raw.write(`event: error\ndata: ${JSON.stringify({ message: '获取提取进度失败', timestamp: Date.now() })}\n\n`);
    }

    reply.raw.end();
    return reply;
  });
}