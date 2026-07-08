import type { FastifyInstance } from 'fastify';
import {
  getChapterOutline,
  getChapterContent,
  restoreNoiseLine,
  unrestoreNoiseLine,
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
      request.log.error(err);
      return reply.status(500).send({ error: '内部错误，请查看服务端日志' });
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
      request.log.error(err);
      return reply.status(500).send({ error: '内部错误，请查看服务端日志' });
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
      request.log.error(err);
      return reply.status(500).send({ error: '内部错误，请查看服务端日志' });
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
      request.log.error(err);
      return reply.status(500).send({ error: '内部错误，请查看服务端日志' });
    }
  });

  // 单章正文（清洗后可读文本 + 噪声行高亮标记），按章懒加载
  fastify.get('/:id/chapters/:index', async (request, reply) => {
    const { id, index } = request.params as { id: string; index: string };
    const ownerId = await resolveOwnerId(request);
    if (!(await ownsBook(id, ownerId))) {
      return reply.status(404).send({ error: 'Book not found' });
    }
    const chapterIndex = Number(index);
    if (!Number.isInteger(chapterIndex) || chapterIndex < 0) {
      return reply.status(400).send({ error: '无效的章节序号' });
    }
    try {
      const content = await getChapterContent(id, chapterIndex);
      if (!content) return reply.status(404).send({ error: 'Book or chapter not found' });
      return content;
    } catch (err) {
      request.log.error(err);
      return reply.status(500).send({ error: '内部错误，请查看服务端日志' });
    }
  });

  // 找回噪声行（标记保留，下次清洗不再删除）
  fastify.post('/:id/chapters/noise/restore', async (request, reply) => {
    const { id } = request.params as { id: string };
    const ownerId = await resolveOwnerId(request);
    if (!(await ownsBook(id, ownerId))) {
      return reply.status(404).send({ error: 'Book not found' });
    }
    const { lineNum } = (request.body ?? {}) as { lineNum?: unknown };
    if (typeof lineNum !== 'number' || !Number.isInteger(lineNum) || lineNum < 1) {
      return reply.status(400).send({ error: '无效的行号' });
    }
    try {
      await restoreNoiseLine(id, lineNum);
      return { ok: true };
    } catch (err) {
      request.log.error(err);
      return reply.status(500).send({ error: '内部错误，请查看服务端日志' });
    }
  });

  // 取消找回（重新允许删除该行）
  fastify.delete('/:id/chapters/noise/restore', async (request, reply) => {
    const { id } = request.params as { id: string };
    const ownerId = await resolveOwnerId(request);
    if (!(await ownsBook(id, ownerId))) {
      return reply.status(404).send({ error: 'Book not found' });
    }
    const { lineNum } = (request.body ?? {}) as { lineNum?: unknown };
    if (typeof lineNum !== 'number' || !Number.isInteger(lineNum) || lineNum < 1) {
      return reply.status(400).send({ error: '无效的行号' });
    }
    try {
      await unrestoreNoiseLine(id, lineNum);
      return { ok: true };
    } catch (err) {
      request.log.error(err);
      return reply.status(500).send({ error: '内部错误，请查看服务端日志' });
    }
  });
}
