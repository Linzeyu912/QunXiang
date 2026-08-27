import type { FastifyInstance } from 'fastify';
import {
  getChapterOutline,
  getChapterContent,
  restoreNoiseLine,
  unrestoreNoiseLine,
  getExtractionArtifacts,
  getPrescanArtifacts,
  listExtractionRuns,
  updateArtifact,
  type ArtifactPatch,
} from '../services/artifacts.service.js';
import { ownsBook, resolveOwnerId } from '../lib/authz.js';
import { prisma } from '@qunxiang/storage';
import { sendServerError } from '../lib/send-error.js';
import { sendBookNotFound } from '../lib/api-errors.js';

export async function artifactsRoutes(fastify: FastifyInstance) {
  // 实体提取富产物（结构化描述/视觉设定/生成提示词/叙事事件），按最新完整运行返回
  fastify.get('/:id/extraction-artifacts', async (request, reply) => {
    const { id } = request.params as { id: string };
    const ownerId = await resolveOwnerId(request);
    if (!(await ownsBook(id, ownerId))) {
      return sendBookNotFound(reply);
    }
    try {
      return await getExtractionArtifacts(id, ownerId!);
    } catch (err) {
      return sendServerError(reply, err, request.log);
    }
  });

  // 更新实体产物（描写 / 提示词）— 人工编辑
  fastify.patch('/:id/extraction-artifacts/:entityType/:entityName', async (request, reply) => {
    const { id, entityType, entityName } = request.params as { id: string; entityType: string; entityName: string };
    if (!['character', 'location', 'item'].includes(entityType)) {
      return reply.status(400).send({ error: '无效的实体类型' });
    }
    const ownerId = await resolveOwnerId(request);
    if (!(await ownsBook(id, ownerId))) {
      return reply.status(404).send({ error: '书籍不存在' });
    }
    const patch = request.body as ArtifactPatch;
    if (!patch || (!patch.visual && !patch.prompt)) {
      return reply.status(400).send({ error: '缺少更新内容' });
    }
    try {
      const result = await updateArtifact(id, ownerId!, entityType as 'character' | 'location' | 'item', decodeURIComponent(entityName), patch);
      if (!result.success) {
        return reply.status(400).send({ error: result.error });
      }
      return { ok: true };
    } catch (err) {
      return sendServerError(reply, err, request.log);
    }
  });

  // 该书历次提取运行（倒序，首条为当前生效运行）
  fastify.get('/:id/extraction-runs', async (request, reply) => {
    const { id } = request.params as { id: string };
    const ownerId = await resolveOwnerId(request);
    if (!(await ownsBook(id, ownerId))) {
      return sendBookNotFound(reply);
    }
    try {
      return await listExtractionRuns(id, ownerId!);
    } catch (err) {
      return sendServerError(reply, err, request.log);
    }
  });

  // 最新官方运行的预扫描中间产物（.intermediate/{run}/prescan）
  fastify.get('/:id/prescan-artifacts', async (request, reply) => {
    const { id } = request.params as { id: string };
    const ownerId = await resolveOwnerId(request);
    if (!(await ownsBook(id, ownerId))) {
      return sendBookNotFound(reply);
    }
    try {
      return await getPrescanArtifacts(id, ownerId!);
    } catch (err) {
      return sendServerError(reply, err, request.log);
    }
  });

  // 章节大纲（预处理+结构化切章的实时结果，带 mtime 缓存）
  fastify.get('/:id/chapters', async (request, reply) => {
    const { id } = request.params as { id: string };
    const ownerId = await resolveOwnerId(request);
    if (!(await ownsBook(id, ownerId))) {
      return sendBookNotFound(reply);
    }
    try {
      const outline = await getChapterOutline(id, ownerId!);
      if (!outline) return reply.status(404).send({ error: '书籍或文件不存在' });
      return outline;
    } catch (err) {
      return sendServerError(reply, err, request.log);
    }
  });

  // 单章正文（清洗后可读文本 + 噪声行高亮标记），按章懒加载
  fastify.get('/:id/chapters/:index', async (request, reply) => {
    const { id, index } = request.params as { id: string; index: string };
    const ownerId = await resolveOwnerId(request);
    if (!(await ownsBook(id, ownerId))) {
      return sendBookNotFound(reply);
    }
    const chapterIndex = Number(index);
    if (!Number.isInteger(chapterIndex) || chapterIndex < 0) {
      return reply.status(400).send({ error: '无效的章节序号' });
    }
    try {
      const content = await getChapterContent(id, ownerId!, chapterIndex);
      if (!content) return reply.status(404).send({ error: '书籍或章节不存在' });
      return content;
    } catch (err) {
      return sendServerError(reply, err, request.log);
    }
  });

  // 找回噪声行（标记保留，下次清洗不再删除）
  fastify.post('/:id/chapters/noise/restore', async (request, reply) => {
    const { id } = request.params as { id: string };
    const ownerId = await resolveOwnerId(request);
    if (!(await ownsBook(id, ownerId))) {
      return sendBookNotFound(reply);
    }
    const { lineNum } = (request.body ?? {}) as { lineNum?: unknown };
    if (typeof lineNum !== 'number' || !Number.isInteger(lineNum) || lineNum < 1) {
      return reply.status(400).send({ error: '无效的行号' });
    }
    try {
      if (!(await restoreNoiseLine(id, ownerId!, lineNum))) return sendBookNotFound(reply);
      // 噪声覆盖变化：原文版本 +1，需重新确认后才能提取（实施包 C4）
      await prisma.book.update({
        where: { id },
        data: { sourceRevision: { increment: 1 }, preprocessConfirmedRevision: null },
      });
      return { ok: true, needsReconfirm: true };
    } catch (err) {
      return sendServerError(reply, err, request.log);
    }
  });

  // 取消找回（重新允许删除该行）
  fastify.delete('/:id/chapters/noise/restore', async (request, reply) => {
    const { id } = request.params as { id: string };
    const ownerId = await resolveOwnerId(request);
    if (!(await ownsBook(id, ownerId))) {
      return sendBookNotFound(reply);
    }
    const { lineNum } = (request.body ?? {}) as { lineNum?: unknown };
    if (typeof lineNum !== 'number' || !Number.isInteger(lineNum) || lineNum < 1) {
      return reply.status(400).send({ error: '无效的行号' });
    }
    try {
      if (!(await unrestoreNoiseLine(id, ownerId!, lineNum))) return sendBookNotFound(reply);
      await prisma.book.update({
        where: { id },
        data: { sourceRevision: { increment: 1 }, preprocessConfirmedRevision: null },
      });
      return { ok: true, needsReconfirm: true };
    } catch (err) {
      return sendServerError(reply, err, request.log);
    }
  });
}
