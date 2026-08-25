import type { FastifyInstance } from 'fastify';
import { VisualSpecRepository } from '@qunxiang/storage';
import { ownsBook, resolveOwnerId } from '../lib/authz.js';
import { sendBookNotFound } from '../lib/api-errors.js';

const VALID_TYPES = new Set(['character', 'item', 'location']);

function toDto(spec: Awaited<ReturnType<typeof VisualSpecRepository.findActiveByEntity>>[number]) {
  return {
    id: spec.id,
    entityType: spec.entityType,
    entityName: spec.entityName,
    variantKey: spec.variantKey,
    version: spec.version,
    status: spec.status,
    prompt: spec.prompt,
    promptSource: spec.promptSource,
    quality: spec.quality,
    styleTags: spec.styleTags,
    model: spec.model,
    primaryImageId: spec.primaryImageId,
    sourceChapters: spec.sourceChapters,
    payload: spec.payload,
    createdAt: spec.createdAt instanceof Date ? spec.createdAt.toISOString() : String(spec.createdAt),
  };
}

/** 只读视觉规格。挂载前缀：/books */
export async function visualSpecRoutes(fastify: FastifyInstance) {
  fastify.get('/:id/visual-specs/:type/:name', async (request, reply) => {
    const { id, type, name } = request.params as { id: string; type: string; name: string };
    if (!VALID_TYPES.has(type)) {
      return reply.status(400).send({ error: '实体类型必须为角色、道具或场景' });
    }
    const ownerId = await resolveOwnerId(request);
    if (!(await ownsBook(id, ownerId))) {
      return sendBookNotFound(reply);
    }
    const specs = await VisualSpecRepository.findOwnedActiveByEntity(id, ownerId!, type, name);
    return { specs: specs.map(toDto) };
  });
}
