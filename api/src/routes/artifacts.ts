import type { FastifyInstance } from 'fastify';
import {
  getChapterOutline,
  getExtractionArtifacts,
  getPrescanArtifacts,
  listExtractionRuns,
} from '../services/artifacts.service.js';
import { ownsBook, resolveOwnerId } from '../lib/authz.js';

export async function artifactsRoutes(fastify: FastifyInstance) {
  // 实体提取富产物（结构化描述/视觉设定/生成提示词/叙事事件），按最新完整运行返回
  fastify.get('/:id/extraction-artifacts', async (request, reply) => {
    const { id } = request.params as { id: string };
    const ownerId = await resolveOwnerId(request);
    if (!(await ownsBook(id, ownerId))) {
      return reply.status(404).send({ error: 'Book not found' });
    }
    try {
      return await getExtractionArtifacts(id);
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // 该书历次提取运行（倒序，首条为当前生效运行）
  fastify.get('/:id/extraction-runs', async (request, reply) => {
    const { id } = request.params as { id: string };
    const ownerId = await resolveOwnerId(request);
    if (!(await ownsBook(id, ownerId))) {
      return reply.status(404).send({ error: 'Book not found' });
    }
    try {
      return await listExtractionRuns(id);
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // 最新官方运行的预扫描中间产物（.intermediate/{run}/prescan）
  fastify.get('/:id/prescan-artifacts', async (request, reply) => {
    const { id } = request.params as { id: string };
    const ownerId = await resolveOwnerId(request);
    if (!(await ownsBook(id, ownerId))) {
      return reply.status(404).send({ error: 'Book not found' });
    }
    try {
      return await getPrescanArtifacts(id);
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // 章节大纲（预处理+结构化切章的实时结果，带 mtime 缓存）
  fastify.get('/:id/chapters', async (request, reply) => {
    const { id } = request.params as { id: string };
    const ownerId = await resolveOwnerId(request);
    if (!(await ownsBook(id, ownerId))) {
      return reply.status(404).send({ error: 'Book not found' });
    }
    try {
      const outline = await getChapterOutline(id);
      if (!outline) return reply.status(404).send({ error: 'Book or file not found' });
      return outline;
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}
