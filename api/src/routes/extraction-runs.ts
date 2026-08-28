/**
 * 提取运行路由（实施包 D1）。
 *
 *   POST /books/:bookId/extraction-runs          创建并启动运行（含预算估算）
 *   GET  /books/:bookId/extraction-runs/estimate 启动前估算（D5）
 *   GET  /books/:bookId/extraction-runs/current  当前/最近运行
 *   GET  /books/:bookId/extraction-runs/:runId   运行详情
 *   GET  /books/:bookId/extraction-runs/:runId/stream  运行事件流（SSE）
 *   POST /books/:bookId/extraction-runs/:runId/pause|resume|cancel
 *
 * 旧 /books/:id/extract* 保留一个版本周期（转发语义一致，不建运行会话）。
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ownsBook, resolveOwnerId } from '../lib/authz.js';
import { sendBookNotFound } from '../lib/api-errors.js';
import { sendServerError } from '../lib/send-error.js';
import { ConflictError, NotFoundError } from '../lib/errors.js';
import {
  createRun,
  estimateRun,
  getRun,
  getCurrentRun,
  pauseRun,
  resumeRun,
  cancelRun,
} from '../services/extraction-run.service.js';
import { createExtractionStream } from '../services/extraction.service.js';

export async function extractionRunRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', async (request, reply) => {
    const { bookId } = request.params as { bookId?: string };
    if (!bookId) return;
    const ownerId = await resolveOwnerId(request);
    if (!(await ownsBook(bookId, ownerId))) {
      return sendBookNotFound(reply);
    }
  });

  // 启动前估算（D5：字数/调用次数/队列前方/历史耗时/上限）
  fastify.get('/:bookId/extraction-runs/estimate', async (request, reply) => {
    const { bookId } = request.params as { bookId: string };
    const ownerId = await resolveOwnerId(request);
    try {
      return { estimate: await estimateRun(bookId, ownerId!) };
    } catch (err) {
      if (err instanceof NotFoundError) return reply.status(404).send({ error: err.message });
      return sendServerError(reply, err, request.log);
    }
  });

  // 创建并启动运行
  fastify.post('/:bookId/extraction-runs', async (request, reply) => {
    const { bookId } = request.params as { bookId: string };
    const ownerId = await resolveOwnerId(request);
    const body = (request.body ?? {}) as { maxCalls?: number; maxTokens?: number };
    try {
      const run = await createRun(bookId, ownerId!, {
        maxCalls: typeof body.maxCalls === 'number' ? body.maxCalls : undefined,
        maxTokens: typeof body.maxTokens === 'number' ? body.maxTokens : undefined,
      });
      return reply.status(201).send({ ...run, message: '运行已创建并开始提取' });
    } catch (err) {
      if (err instanceof ConflictError) return reply.status(409).send({ error: err.message });
      if (err instanceof NotFoundError) return reply.status(404).send({ error: err.message });
      return sendServerError(reply, err, request.log);
    }
  });

  // 当前/最近运行
  fastify.get('/:bookId/extraction-runs/current', async (request) => {
    const { bookId } = request.params as { bookId: string };
    const ownerId = await resolveOwnerId(request);
    return getCurrentRun(bookId, ownerId!);
  });

  // 运行详情
  fastify.get('/:bookId/extraction-runs/:runId', async (request, reply) => {
    const { bookId, runId } = request.params as { bookId: string; runId: string };
    const ownerId = await resolveOwnerId(request);
    try {
      return await getRun(bookId, ownerId!, runId);
    } catch (err) {
      if (err instanceof NotFoundError) return reply.status(404).send({ error: err.message });
      return sendServerError(reply, err, request.log);
    }
  });

  // 运行事件流（SSE，转发该书管线事件）
  fastify.get('/:bookId/extraction-runs/:runId/stream', async (request, reply) => {
    const { bookId, runId } = request.params as { bookId: string; runId: string };
    const ownerId = await resolveOwnerId(request);
    try {
      await getRun(bookId, ownerId!, runId); // 校验归属与存在
    } catch {
      return sendBookNotFound(reply);
    }

    // 客户端断开必须中止生成器：否则 eventBus 监听器与心跳轮询要等到
    // 终态事件才释放，反复断开重连会持续累积监听器。
    const abortController = new AbortController();
    const abortStream = () => abortController.abort();
    request.raw.once('aborted', abortStream);
    reply.raw.once('close', abortStream);

    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    });
    try {
      for await (const chunk of createExtractionStream(bookId, ownerId!, abortController.signal)) {
        if (abortController.signal.aborted || reply.raw.destroyed || reply.raw.writableEnded) break;
        reply.raw.write(chunk);
      }
    } catch (err) {
      request.log.error(err);
      if (!abortController.signal.aborted && !reply.raw.destroyed && !reply.raw.writableEnded) {
        reply.raw.write(`event: error\ndata: ${JSON.stringify({ message: '获取运行事件流失败', timestamp: Date.now() })}\n\n`);
      }
    } finally {
      request.raw.removeListener('aborted', abortStream);
      reply.raw.removeListener('close', abortStream);
      if (!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.end();
    }
    return reply;
  });

  const runAction = (action: 'pause' | 'resume' | 'cancel') => async (request: FastifyRequest, reply: FastifyReply) => {
    const { bookId, runId } = (request.params as { bookId: string; runId: string });
    const ownerId = await resolveOwnerId(request);
    try {
      if (action === 'pause') {
        await pauseRun(bookId, ownerId!, runId);
        return { ok: true, message: '已请求暂停：当前模型调用完成后停止，可随时恢复' };
      }
      if (action === 'resume') {
        const result = await resumeRun(bookId, ownerId!, runId);
        return { ok: true, ...result, message: `已从「${result.resumedFrom}」恢复运行` };
      }
      await cancelRun(bookId, ownerId!, runId);
      return { ok: true, message: '已请求取消：未发布的结果将被丢弃，最近稳定结果保持不变' };
    } catch (err) {
      if (err instanceof ConflictError) return reply.status(409).send({ error: err.message });
      if (err instanceof NotFoundError) return reply.status(404).send({ error: err.message });
      return sendServerError(reply, err, request.log);
    }
  };

  fastify.post('/:bookId/extraction-runs/:runId/pause', runAction('pause'));
  fastify.post('/:bookId/extraction-runs/:runId/resume', runAction('resume'));
  fastify.post('/:bookId/extraction-runs/:runId/cancel', runAction('cancel'));
}
