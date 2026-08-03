import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  approveStoriesBatch,
  approveStory,
  BadRequestError,
  ConflictError,
  createStoryStream,
  extractAssets,
  getAssetPack,
  getAssetPrompts,
  getEpisodes,
  getSegmentationStatus,
  getStory,
  getStoryboardPack,
  getVideoPromptPack,
  listBoundaryReviews,
  listStories,
  NotFoundError,
  patchAsset,
  resolveBoundaryReview,
  startSegmentation,
  type AssetPatch,
  type AssetType,
  type BoundaryDecision,
} from '../services/story.service.js';
import { ownsBook, resolveOwnerId } from '../lib/authz.js';
import { sendBookNotFound } from '../lib/api-errors.js';

function sendError(reply: FastifyReply, err: unknown) {
  if (err instanceof NotFoundError) return reply.status(404).send({ error: err.message });
  if (err instanceof ConflictError) return reply.status(409).send({ error: err.message });
  if (err instanceof BadRequestError) return reply.status(400).send({ error: err.message });
  reply.log.error(err);
  return reply.status(500).send({ error: '内部错误，请查看服务端日志' });
}

export async function storiesRoutes(fastify: FastifyInstance) {
  // 所有路由都以 :id 作为 bookId，统一在 preHandler 里校验归属。
  // preHandler 在路由 handler（含 SSE 的 writeHead）之前执行，未通过直接 404，
  // 避免无权连接进入 SSE 流。
  fastify.addHook('preHandler', async (request, reply) => {
    const { id } = request.params as { id?: string };
    if (!id) return;
    const ownerId = await resolveOwnerId(request);
    if (!(await ownsBook(id, ownerId))) {
      return sendBookNotFound(reply);
    }
  });

  // ---- 切分（异步 + SSE） ----

  // 限流：切分会触发 LLM 调用与磁盘写入，防止恶意刷爆。
  fastify.post('/:id/stories/segment', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { maxChaptersPerSegment?: number; autoApprove?: boolean };
    try {
      const { taskId, existing } = await startSegmentation(id, request.user.userId, {
        maxChaptersPerSegment: body.maxChaptersPerSegment,
        autoApprove: body.autoApprove,
      });
      return { taskId, message: existing ? '故事切分正在进行' : '已开始故事切分' };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  fastify.get('/:id/stories/segment/status', async (request, reply) => {
    const { taskId } = request.query as { taskId?: string };
    if (!taskId) return reply.status(400).send({ error: '缺少 taskId 参数' });
    const task = await getSegmentationStatus(taskId, request.user.userId);
    if (!task) return reply.status(404).send({ error: '任务不存在' });
    return task;
  });

  fastify.get('/:id/stories/segment/stream', async (request, reply) => {
    const { id: bookId } = request.params as { id: string };
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    try {
      for await (const chunk of createStoryStream(bookId, request.user.userId)) {
        reply.raw.write(chunk);
      }
    } catch (err) {
      reply.log.error(err);
      reply.raw.write(
        `event: error\ndata: ${JSON.stringify({ message: '故事进度流发生错误', timestamp: Date.now() })}\n\n`,
      );
    }
    reply.raw.end();
    return reply;
  });

  // ---- 故事段 ----

  fastify.get('/:id/stories', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return await listStories(id, request.user.userId);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  // 注意：先注册字面量路径（boundary-reviews / approve-batch），再注册 :storyId 参数路径
  fastify.get('/:id/stories/boundary-reviews', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { status } = request.query as { status?: 'pending' | 'resolved' };
    try {
      return await listBoundaryReviews(id, request.user.userId, status);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  fastify.post('/:id/stories/boundary-reviews/:reviewId/resolve', async (request, reply) => {
    const { id, reviewId } = request.params as { id: string; reviewId: string };
    const { decision } = request.body as { decision: BoundaryDecision };
    if (decision !== 'confirm' && decision !== 'merge_with_previous') {
      return reply.status(400).send({ error: '裁决类型必须为确认或与上一段合并' });
    }
    try {
      return await resolveBoundaryReview(id, request.user.userId, reviewId, decision);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  fastify.post('/:id/stories/approve-batch', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { storyIds, approved } = request.body as { storyIds: string[]; approved: boolean };
    if (!Array.isArray(storyIds) || storyIds.length === 0) {
      return reply.status(400).send({ error: '缺少故事段编号' });
    }
    try {
      return await approveStoriesBatch(id, request.user.userId, storyIds, approved !== false);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  fastify.get('/:id/stories/:storyId', async (request, reply) => {
    const { id, storyId } = request.params as { id: string; storyId: string };
    const { includeSource } = request.query as { includeSource?: string };
    try {
      return await getStory(id, request.user.userId, storyId, includeSource === 'true');
    } catch (err) {
      return sendError(reply, err);
    }
  });

  fastify.post('/:id/stories/:storyId/approve', async (request, reply) => {
    const { id, storyId } = request.params as { id: string; storyId: string };
    const { approved } = request.body as { approved: boolean };
    try {
      return await approveStory(id, request.user.userId, storyId, approved !== false);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  // ---- 故事资产 ----

  fastify.post('/:id/stories/:storyId/assets/extract', async (request, reply) => {
    const { id, storyId } = request.params as { id: string; storyId: string };
    try {
      return await extractAssets(id, request.user.userId, storyId);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  fastify.get('/:id/stories/:storyId/assets', async (request, reply) => {
    const { id, storyId } = request.params as { id: string; storyId: string };
    try {
      return await getAssetPack(id, request.user.userId, storyId);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  fastify.get('/:id/stories/:storyId/asset-prompts', async (request, reply) => {
    const { id, storyId } = request.params as { id: string; storyId: string };
    try {
      return await getAssetPrompts(id, request.user.userId, storyId);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  fastify.patch('/:id/stories/:storyId/assets/:assetType/:assetName', async (request, reply) => {
    const { id, storyId, assetType, assetName } = request.params as {
      id: string;
      storyId: string;
      assetType: string;
      assetName: string;
    };
    if (assetType !== 'character' && assetType !== 'scene' && assetType !== 'prop') {
      return reply.status(400).send({ error: '资产类型必须为角色、场景或道具' });
    }
    try {
      return await patchAsset(
        id,
        request.user.userId,
        storyId,
        assetType as AssetType,
        decodeURIComponent(assetName),
        request.body as AssetPatch,
      );
    } catch (err) {
      return sendError(reply, err);
    }
  });

  // ---- 剧集产物 ----

  fastify.get('/:id/stories/:storyId/episodes', async (request, reply) => {
    const { id, storyId } = request.params as { id: string; storyId: string };
    try {
      return await getEpisodes(id, request.user.userId, storyId);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  fastify.get('/:id/stories/:storyId/episodes/:episodeNo/storyboard', async (request, reply) => {
    const { id, storyId, episodeNo } = request.params as {
      id: string;
      storyId: string;
      episodeNo: string;
    };
    try {
      return await getStoryboardPack(id, request.user.userId, storyId, Number(episodeNo));
    } catch (err) {
      return sendError(reply, err);
    }
  });

  fastify.get('/:id/stories/:storyId/episodes/:episodeNo/video-prompts', async (request, reply) => {
    const { id, storyId, episodeNo } = request.params as {
      id: string;
      storyId: string;
      episodeNo: string;
    };
    try {
      return await getVideoPromptPack(id, request.user.userId, storyId, Number(episodeNo));
    } catch (err) {
      return sendError(reply, err);
    }
  });
}
