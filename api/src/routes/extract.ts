import type { FastifyInstance } from 'fastify';
import { startExtraction, resumeExtraction, pollExtractionStatus, getExtractionStages, createExtractionStream } from '../services/extraction.service.js';
import { ownsBook, resolveOwnerId } from '../lib/authz.js';
import { ConflictError, NotFoundError } from '../lib/errors.js';
import { sendBookNotFound } from '../lib/api-errors.js';

export async function extractRoutes(fastify: FastifyInstance) {
  // Trigger extraction
  // 限流：每次提取会清空历史任务并触发 LLM 调用（计费），防止恶意刷爆。
  fastify.post('/:id/extract', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const ownerId = await resolveOwnerId(request);
    if (!(await ownsBook(id, ownerId))) {
      return sendBookNotFound(reply);
    }
    const userId = request.user!.userId;

    try {
      const { taskId } = await startExtraction(id, userId);
      return { taskId, message: '已开始提取' };
    } catch (error) {
      if (error instanceof ConflictError) {
        return reply.status(409).send({ error: (error as Error).message });
      }
      request.log.error(error);
      return reply.status(500).send({ error: '提取触发失败，请查看服务端日志' });
    }
  });

  // ISSUE-7 断点续传：从第一个失败 stage 继续
  fastify.post('/:id/extract/resume', async (request, reply) => {
    const { id } = request.params as { id: string };
    const ownerId = await resolveOwnerId(request);
    if (!(await ownsBook(id, ownerId))) {
      return reply.status(404).send({ error: 'Book not found' });
    }
    const userId = request.user!.userId;

    try {
      const result = await resumeExtraction(id, userId);
      return { ...result, message: `Resumed from stage: ${result.resumedFrom}` };
    } catch (error) {
      if (error instanceof ConflictError) {
        return reply.status(409).send({ error: (error as Error).message });
      }
      if (error instanceof NotFoundError) {
        return reply.status(404).send({ error: (error as Error).message });
      }
      request.log.error(error);
      return reply.status(500).send({ error: '断点续传失败，请查看服务端日志' });
    }
  });

  // Poll extraction status
  fastify.get('/:id/extract/status', async (request, reply) => {
    const { id } = request.params as { id: string };
    const ownerId = await resolveOwnerId(request);
    if (!(await ownsBook(id, ownerId))) {
      return sendBookNotFound(reply);
    }
    const { taskId } = request.query as { taskId?: string };

    if (!taskId) {
      return reply.status(400).send({ error: '缺少 taskId 参数' });
    }

    // 同时校验任务归属用户和路径中的书籍，避免用本人书籍 ID 读取其他任务。
    const status = await pollExtractionStatus(taskId, ownerId!, id);
    return status;
  });

  // Get extraction stages progress
  fastify.get('/:id/extract/stages', async (request, reply) => {
    const { id } = request.params as { id: string };
    const ownerId = await resolveOwnerId(request);
    if (!(await ownsBook(id, ownerId))) {
      return sendBookNotFound(reply);
    }

    try {
      const stages = await getExtractionStages(id, ownerId!);
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
      return sendBookNotFound(reply);
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
      for await (const chunk of createExtractionStream(bookId, ownerId!)) {
        reply.raw.write(chunk);
      }
    } catch (err) {
      console.error('提取进度流发生错误：', err);
      reply.raw.write(`event: error\ndata: ${JSON.stringify({ message: '获取提取进度失败', timestamp: Date.now() })}\n\n`);
    }

    reply.raw.end();
    return reply;
  });
}
