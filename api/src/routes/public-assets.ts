import type { FastifyInstance, FastifyReply } from 'fastify';
import { resolveOwnerId } from '../lib/authz.js';
import { sendServerError } from '../lib/send-error.js';
import {
  publishAsset,
  listPublicAssets,
  listMyPublicAssets,
  listPopularTags,
  getPublicAssetDetail,
  takeAsset,
  unlistAsset,
  PublicAssetError,
  type ListPublicAssetsQuery,
} from '../services/public-asset.service.js';

const ASSET_NOT_FOUND_BODY = Object.freeze({
  code: 'PUBLIC_ASSET_NOT_FOUND',
  error: '素材不存在或已下架',
});

/**
 * 公共素材库路由。全部需登录。前缀 /public-assets。
 *
 * 错误约定：无权限/不存在一律中文 404（不泄露资源存在性）。
 * 限流：发布 10/min，拿取 20/min。
 */
export async function publicAssetRoutes(fastify: FastifyInstance) {
  // ── 发布 ──
  fastify.post('/', {
    config: {
      rateLimit: { max: 10, timeWindow: '1 minute' },
    },
  }, async (request, reply) => {
    const ownerId = await resolveOwnerId(request);
    if (!ownerId) return reply.status(401).send({ error: '请先登录' });

    const body = (request.body ?? {}) as {
      bookId?: string;
      entityType?: string;
      entityId?: string;
      summary?: string;
      tags?: string[];
      showSource?: boolean;
    };

    if (!body.bookId || !body.entityType || !body.entityId) {
      return reply.status(400).send({ error: '缺少必要参数：bookId、entityType、entityId' });
    }

    try {
      const result = await publishAsset(ownerId, {
        bookId: body.bookId,
        entityType: body.entityType,
        entityId: body.entityId,
        summary: body.summary,
        tags: body.tags,
        showSource: body.showSource,
      });
      return { id: result.id };
    } catch (err) {
      if (err instanceof PublicAssetError) {
        const statusCode = err.statusCode === 404 ? 404 : 400;
        return reply.status(statusCode).send({ error: err.message });
      }
      return sendServerError(reply, err, request.log);
    }
  });

  // ── 浏览公共池 ──
  fastify.get('/', async (request, reply) => {
    const ownerId = await resolveOwnerId(request);
    if (!ownerId) return reply.status(401).send({ error: '请先登录' });

    const query = request.query as {
      kind?: string;
      tags?: string | string[];
      q?: string;
      sort?: string;
      cursorCreatedAt?: string;
      cursorId?: string;
    };

    // tags 可以重复出现（tags=a&tags=b），Fastify 解析为 string | string[]
    const tags = query.tags
      ? Array.isArray(query.tags)
        ? query.tags
        : [query.tags]
      : undefined;

    const listQuery: ListPublicAssetsQuery = {
      kind: query.kind,
      tags,
      q: query.q,
      sort: query.sort === 'hot' ? 'hot' : 'new',
      cursor:
        query.cursorCreatedAt && query.cursorId
          ? { createdAt: query.cursorCreatedAt, id: query.cursorId }
          : null,
    };

    try {
      const result = await listPublicAssets(listQuery);
      return result;
    } catch (err) {
      return sendServerError(reply, err, request.log);
    }
  });

  // ── 热门标签聚合 ──
  fastify.get('/tags', async (request, reply) => {
    const ownerId = await resolveOwnerId(request);
    if (!ownerId) return reply.status(401).send({ error: '请先登录' });

    try {
      const items = await listPopularTags(30);
      return { items };
    } catch (err) {
      return sendServerError(reply, err, request.log);
    }
  });

  // ── 我的发布 ──
  fastify.get('/mine', async (request, reply) => {
    const ownerId = await resolveOwnerId(request);
    if (!ownerId) return reply.status(401).send({ error: '请先登录' });

    try {
      const items = await listMyPublicAssets(ownerId);
      return { items };
    } catch (err) {
      return sendServerError(reply, err, request.log);
    }
  });

  // ── 详情 ──
  fastify.get('/:id', async (request, reply) => {
    const ownerId = await resolveOwnerId(request);
    if (!ownerId) return reply.status(401).send({ error: '请先登录' });

    const { id } = request.params as { id: string };

    try {
      const detail = await getPublicAssetDetail(id);
      return detail;
    } catch (err) {
      if (err instanceof PublicAssetError && err.statusCode === 404) {
        return reply.status(404).send(ASSET_NOT_FOUND_BODY);
      }
      return sendServerError(reply, err, request.log);
    }
  });

  // ── 拿取 ──
  fastify.post('/:id/take', {
    config: {
      rateLimit: { max: 20, timeWindow: '1 minute' },
    },
  }, async (request, reply) => {
    const ownerId = await resolveOwnerId(request);
    if (!ownerId) return reply.status(401).send({ error: '请先登录' });

    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { targetBookId?: string };

    if (!body.targetBookId) {
      return reply.status(400).send({ error: '缺少必要参数：targetBookId' });
    }

    try {
      const result = await takeAsset(id, ownerId, { targetBookId: body.targetBookId });
      if (result.alreadyTaken) {
        return reply.status(409).send({
          code: 'ALREADY_TAKEN',
          error: '该素材已拿取到目标书',
          entityId: result.entityId,
          entityName: result.entityName,
        });
      }
      return {
        entityId: result.entityId,
        entityName: result.entityName,
      };
    } catch (err) {
      if (err instanceof PublicAssetError) {
        const statusCode = err.statusCode === 404 ? 404 : 400;
        return reply.status(statusCode).send({ error: err.message });
      }
      return sendServerError(reply, err, request.log);
    }
  });

  // ── 下架 ──
  fastify.post('/:id/unlist', async (request, reply) => {
    const ownerId = await resolveOwnerId(request);
    if (!ownerId) return reply.status(401).send({ error: '请先登录' });

    const { id } = request.params as { id: string };

    try {
      const ok = await unlistAsset(id, ownerId);
      if (!ok) {
        return reply.status(404).send(ASSET_NOT_FOUND_BODY);
      }
      return { success: true };
    } catch (err) {
      return sendServerError(reply, err, request.log);
    }
  });
}
