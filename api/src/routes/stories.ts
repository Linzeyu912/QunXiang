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

function sendError(reply: FastifyReply, err: unknown) {
  if (err instanceof NotFoundError) return reply.status(404).send({ error: err.message });
  if (err instanceof ConflictError) return reply.status(409).send({ error: err.message });
  if (err instanceof BadRequestError) return reply.status(400).send({ error: err.message });
  return reply.status(500).send({ error: err instanceof Error ? err.message : String(err) });
}

export async function storiesRoutes(fastify: FastifyInstance) {
  // ---- 切分（异步 + SSE） ----

  fastify.post('/:id/stories/segment', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { maxChaptersPerSegment?: number; autoApprove?: boolean };
    try {
      const { taskId, existing } = await startSegmentation(id, {
        maxChaptersPerSegment: body.maxChaptersPerSegment,
        autoApprove: body.autoApprove,
      });
      return { taskId, message: existing ? 'Segmentation already running' : 'Segmentation started' };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  fastify.get('/:id/stories/segment/status', async (request, reply) => {
    const { taskId } = request.query as { taskId?: string };
    if (!taskId) return reply.status(400).send({ error: 'taskId is required' });
    const task = getSegmentationStatus(taskId);
    if (!task) return reply.status(404).send({ error: 'Task not found' });
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
      for await (const chunk of createStoryStream(bookId)) {
        reply.raw.write(chunk);
      }
    } catch (err) {
      reply.raw.write(
        `event: error\ndata: ${JSON.stringify({ message: String(err), timestamp: Date.now() })}\n\n`,
      );
    }
    reply.raw.end();
    return reply;
  });

  // ---- 故事段 ----

  fastify.get('/:id/stories', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return await listStories(id);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  // 注意：先注册字面量路径（boundary-reviews / approve-batch），再注册 :storyId 参数路径
  fastify.get('/:id/stories/boundary-reviews', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { status } = request.query as { status?: 'pending' | 'resolved' };
    try {
      return await listBoundaryReviews(id, status);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  fastify.post('/:id/stories/boundary-reviews/:reviewId/resolve', async (request, reply) => {
    const { id, reviewId } = request.params as { id: string; reviewId: string };
    const { decision } = request.body as { decision: BoundaryDecision };
    if (decision !== 'confirm' && decision !== 'merge_with_previous') {
      return reply.status(400).send({ error: 'decision must be confirm or merge_with_previous' });
    }
    try {
      return await resolveBoundaryReview(id, reviewId, decision);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  fastify.post('/:id/stories/approve-batch', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { storyIds, approved } = request.body as { storyIds: string[]; approved: boolean };
    if (!Array.isArray(storyIds) || storyIds.length === 0) {
      return reply.status(400).send({ error: 'storyIds is required' });
    }
    try {
      return await approveStoriesBatch(id, storyIds, approved !== false);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  fastify.get('/:id/stories/:storyId', async (request, reply) => {
    const { id, storyId } = request.params as { id: string; storyId: string };
    const { includeSource } = request.query as { includeSource?: string };
    try {
      return await getStory(id, storyId, includeSource === 'true');
    } catch (err) {
      return sendError(reply, err);
    }
  });

  fastify.post('/:id/stories/:storyId/approve', async (request, reply) => {
    const { id, storyId } = request.params as { id: string; storyId: string };
    const { approved } = request.body as { approved: boolean };
    try {
      return await approveStory(id, storyId, approved !== false);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  // ---- 故事资产 ----

  fastify.post('/:id/stories/:storyId/assets/extract', async (request, reply) => {
    const { id, storyId } = request.params as { id: string; storyId: string };
    try {
      return await extractAssets(id, storyId);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  fastify.get('/:id/stories/:storyId/assets', async (request, reply) => {
    const { id, storyId } = request.params as { id: string; storyId: string };
    try {
      return await getAssetPack(id, storyId);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  fastify.get('/:id/stories/:storyId/asset-prompts', async (request, reply) => {
    const { id, storyId } = request.params as { id: string; storyId: string };
    try {
      return await getAssetPrompts(id, storyId);
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
      return reply.status(400).send({ error: 'assetType must be character, scene or prop' });
    }
    try {
      return await patchAsset(
        id,
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
      return await getEpisodes(id, storyId);
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
      return await getStoryboardPack(id, storyId, Number(episodeNo));
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
      return await getVideoPromptPack(id, storyId, Number(episodeNo));
    } catch (err) {
      return sendError(reply, err);
    }
  });
}
