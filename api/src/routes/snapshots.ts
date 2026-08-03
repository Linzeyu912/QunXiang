import type { FastifyInstance } from 'fastify';
import {
  AssetSnapshotRepository,
  SnapshotObjectRepository,
} from '@novel-agent/storage';
import { loadOwnedBook, resolveOwnerId } from '../lib/authz.js';
import { sendServerError } from '../lib/send-error.js';
import { sendBookNotFound } from '../lib/api-errors.js';
import {
  prepareSnapshot,
  getDownloadState,
  getSnapshotSummary,
  authorizeDownload,
} from '../services/snapshot.service.js';

/**
 * 快照与下载路由（C1）。
 *
 * 全部挂在 /books 前缀下，沿用 loadOwnedBook + sendBookNotFound 统一中文 404，
 * 不泄露资源存在性。签名 URL 由专用 POST 返回，不入库不入日志。
 */
export async function snapshotRoutes(fastify: FastifyInstance) {
  // GET /:id/download-state
  fastify.get<{
    Params: { id: string };
  }>('/:id/download-state', async (request, reply) => {
    try {
      const ownerId = await resolveOwnerId(request);
      const book = await loadOwnedBook(request.params.id, ownerId);
      if (!book) return sendBookNotFound(reply);

      const state = await getDownloadState(book, ownerId!);
      return reply.send(state);
    } catch (err) {
      return sendServerError(reply, err, request.log);
    }
  });

  // POST /:id/snapshots —— 为当前成果创建/复用快照任务
  fastify.post<{
    Params: { id: string };
  }>('/:id/snapshots', async (request, reply) => {
    try {
      const ownerId = await resolveOwnerId(request);
      const book = await loadOwnedBook(request.params.id, ownerId);
      if (!book) return sendBookNotFound(reply);

      const result = await prepareSnapshot(book, ownerId!);
      return reply.send(result);
    } catch (err) {
      return sendServerError(reply, err, request.log);
    }
  });

  // GET /:id/snapshots/:snapshotId —— 脱敏摘要
  fastify.get<{
    Params: { id: string; snapshotId: string };
  }>('/:id/snapshots/:snapshotId', async (request, reply) => {
    try {
      const ownerId = await resolveOwnerId(request);
      const book = await loadOwnedBook(request.params.id, ownerId);
      if (!book) return sendBookNotFound(reply);

      const { snapshotId } = request.params;
      const summary = await getSnapshotSummary(book, snapshotId, ownerId!);
      if (!summary) return reply.status(404).send({ code: 'SNAPSHOT_NOT_FOUND', error: '快照不存在或无权访问' });

      // 补全文件数（按快照计数，不暴露对象键）
      try {
        const list = await SnapshotObjectRepository.listForSnapshot(snapshotId);
        summary.fileCount = list.filter((r) => r.category !== 'manifest').length;
      } catch {
        // 保持 null
      }
      return reply.send(summary);
    } catch (err) {
      return sendServerError(reply, err, request.log);
    }
  });

  // POST /:id/snapshots/:snapshotId/download-authorizations
  fastify.post<{
    Params: { id: string; snapshotId: string };
  }>('/:id/snapshots/:snapshotId/download-authorizations', async (request, reply) => {
    try {
      const ownerId = await resolveOwnerId(request);
      const book = await loadOwnedBook(request.params.id, ownerId);
      if (!book) return sendBookNotFound(reply);

      const auth = await authorizeDownload(book, request.params.snapshotId, ownerId!);
      return reply.send(auth);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // 已知中文错误（如尚未准备完成、不属于该账号）→ 透传 sendServerError
      if (/不存在|无权|尚未准备完成|过期/.test(message)) {
        if (/不存在|无权/.test(message)) {
          return reply.status(404).send({ code: 'SNAPSHOT_NOT_FOUND', error: '快照不存在或无权访问' });
        }
        return reply.status(409).send({ error: message });
      }
      return sendServerError(reply, err, request.log);
    }
  });
}

// 防止未使用导入
void AssetSnapshotRepository;
