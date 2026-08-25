import type { FastifyInstance } from 'fastify';
import { ownsBook, resolveOwnerId } from '../lib/authz.js';
import { EntityImageRepository } from '@qunxiang/storage';
import {
  generateEntityImage,
  uploadEntityImage,
  listEntityImages,
  readImageRaw,
  deleteEntityImageById,
  setPrimaryImage,
  ImageGenerationError,
  type EntityType,
} from '../services/image-generation.service.js';
import { sendBookNotFound } from '../lib/api-errors.js';

/**
 * 实体图片路由（多张画廊）。挂载前缀：/books。分两组静态前缀避免参数化路由歧义：
 *   实体维度  /:id/images/:type/:name            —— GET 列表 / POST 生成 / POST 上传
 *   图片维度  /:id/entity-images/:imageId        —— GET 二进制 / DELETE 删除 / PATCH 设主图
 *
 * :type ∈ character | item | location
 * :name 为实体名（中文，URL 里直接传，Fastify 自动 decodeURIComponent）
 */
export async function imageRoutes(fastify: FastifyInstance) {
  const VALID_TYPES = new Set<EntityType>(['character', 'item', 'location']);

  function validateType(type: string): type is EntityType {
    return VALID_TYPES.has(type as EntityType);
  }

  // ── 画廊列表（空画廊也 200）──
  fastify.get('/:id/images/:type/:name', async (request, reply) => {
    const { id, type, name } = request.params as { id: string; type: string; name: string };
    if (!validateType(type)) {
      return reply.status(400).send({ error: '实体类型必须为角色、道具或场景' });
    }
    const ownerId = await resolveOwnerId(request);
    if (!(await ownsBook(id, ownerId))) {
      return sendBookNotFound(reply);
    }
    const images = await listEntityImages(id, ownerId!, type, name);
    return { images };
  });

  // ── AI 生成一张（画廊新增）──
  // 查询参数：aspectRatio 宽高比；stage 年龄阶段；outfit 服饰套系（scene 标签，仅角色）
  fastify.post('/:id/images/:type/:name', async (request, reply) => {
    const { id, type, name } = request.params as { id: string; type: string; name: string };
    const { aspectRatio, stage, outfit } = (request.query || {}) as { aspectRatio?: string; stage?: string; outfit?: string };

    if (!validateType(type)) {
      return reply.status(400).send({ error: '实体类型必须为角色、道具或场景' });
    }
    if (!name) {
      return reply.status(400).send({ error: '缺少实体名称' });
    }

    const ownerId = await resolveOwnerId(request);
    if (!(await ownsBook(id, ownerId))) {
      return sendBookNotFound(reply);
    }

    try {
      return await generateEntityImage(id, ownerId!, type, name, { aspectRatio, stage, outfit });
    } catch (error) {
      return reply.status(errStatus(error)).send(errBody(error));
    }
  });

  // ── 用户上传一张（multipart，画廊新增）──
  fastify.post('/:id/images/:type/:name/upload', async (request, reply) => {
    const { id, type, name } = request.params as { id: string; type: string; name: string };

    if (!validateType(type)) {
      return reply.status(400).send({ error: '实体类型必须为角色、道具或场景' });
    }
    if (!name) {
      return reply.status(400).send({ error: '缺少实体名称' });
    }

    const ownerId = await resolveOwnerId(request);
    if (!(await ownsBook(id, ownerId))) {
      return sendBookNotFound(reply);
    }

    const data = await request.file();
    if (!data) {
      return reply.status(400).send({ error: '未检测到上传文件' });
    }
    const buffer = await data.toBuffer();

    try {
      return await uploadEntityImage(id, ownerId!, type, name, buffer, data.mimetype);
    } catch (error) {
      return reply.status(errStatus(error)).send(errBody(error));
    }
  });

  // ── 单张二进制（前端用 Authorization fetch 后转 Blob URL）──
  fastify.get('/:id/entity-images/:imageId', async (request, reply) => {
    const { id, imageId } = request.params as { id: string; imageId: string };

    const ownerId = await resolveOwnerId(request);
    if (!(await ownsBook(id, ownerId))) {
      return sendBookNotFound(reply);
    }

    const raw = await readImageRaw(imageId, id, ownerId!);
    if (!raw) {
      return sendBookNotFound(reply);
    }

    // URL 含 imageId，新图=新 id=新 URL，删除即不可达 → 长缓存安全。
    reply.header('Content-Type', raw.mime);
    reply.header('Cache-Control', 'private, max-age=3600');
    return reply.send(raw.buffer);
  });

  // ── 删单张（DB + 文件，删主图则提升下一张）──
  fastify.delete('/:id/entity-images/:imageId', async (request, reply) => {
    const { id, imageId } = request.params as { id: string; imageId: string };

    const ownerId = await resolveOwnerId(request);
    if (!(await ownsBook(id, ownerId))) {
      return sendBookNotFound(reply);
    }
    if (!(await deleteEntityImageById(imageId, id, ownerId!))) return sendBookNotFound(reply);
    return { ok: true };
  });

  // ── 设主图（事务清同实体其他主图）──
  fastify.patch('/:id/entity-images/:imageId/primary', async (request, reply) => {
    const { id, imageId } = request.params as { id: string; imageId: string };

    const ownerId = await resolveOwnerId(request);
    if (!(await ownsBook(id, ownerId))) {
      return sendBookNotFound(reply);
    }
    const meta = await setPrimaryImage(imageId, id, ownerId!);
    return meta ?? sendBookNotFound(reply);
  });
}

// ── 错误 → HTTP 状态码/响应体映射 ──
function errStatus(error: unknown): number {
  if (error instanceof ImageGenerationError) {
    if (['NO_RUN', 'NO_PROMPTS_FILE', 'NO_PROMPT_FOR_ENTITY'].includes(error.code)) return 404;
    if (error.code === 'PROVIDER_NOT_CONFIGURED') return 503;
    if (error.code === 'UNSUPPORTED_MIME') return 400;
    return 500;
  }
  return 500;
}

function errBody(error: unknown): { error: string; code?: string } {
  if (error instanceof ImageGenerationError) {
    return { error: error.message, code: error.code };
  }
  const msg = error instanceof Error ? error.message : String(error);
  return { error: /[\u4e00-\u9fff]/.test(msg) ? msg : '图片处理失败，请稍后重试' };
}
