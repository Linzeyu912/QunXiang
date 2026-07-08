import type { FastifyInstance } from 'fastify';
import { startExtraction, pollExtractionStatus, getExtractionStages, createExtractionStream } from '../services/extraction.service.js';
import { ownsBook, resolveOwnerId } from '../lib/authz.js';
import { ConflictError } from '../lib/errors.js';

export async function extractRoutes(fastify: FastifyInstance) {
  // Trigger extraction
  // 限流：每次提取会清空历史任务并触发 LLM 调用（计费），防止恶意刷爆。
  fastify.post('/:id/extract', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (request, reply) => {
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

    // 传 bookId 给 service，断言该 task 确实属于路径里的 book（堵 IDOR：
    // 否则用户可用自己名下的 bookId 过 ownsBook 校验，换上别人的 taskId 读到他人进度/结果）
    const status = await pollExtractionStatus(taskId, id);
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