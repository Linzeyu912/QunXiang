import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getSharedObjectStore, verifyFsDownloadToken } from '@qunxiang/storage';

/**
 * 内部对象下载路由（C1）：GET /objects/dl?t=<token>
 *
 * 仅服务 FsObjectStore 的 HMAC 短时令牌；S3 签名下载由 createDownloadUrl 直接指向远端，
 * 不经过本路由。Token 校验失败/过期统一中文 401；支持 Range 续传。
 *
 * 安全：secret 仅在服务端持有；令牌不入库不入日志；objectKey 不出现在响应头中
 * （Content-Location 等）。
 */
export async function objectDownloadRoutes(fastify: FastifyInstance) {
  fastify.get<{
    Querystring: { t?: string };
  }>('/objects/dl', async (request: FastifyRequest<{ Querystring: { t?: string } }>, reply: FastifyReply) => {
    const token = request.query.t;
    const secret = process.env.OBJECT_STORAGE_SIGN_SECRET;
    if (!token || !secret) {
      return reply.status(401).send({ code: 'OBJECT_DOWNLOAD_DENIED', error: '下载授权无效，请重新获取' });
    }

    const now = new Date();
    const payload = verifyFsDownloadToken(token, secret, now);
    if (!payload) {
      return reply.status(401).send({ code: 'OBJECT_DOWNLOAD_DENIED', error: '下载授权已过期或无效，请重新获取' });
    }

    const rangeHeader = request.headers.range;
    const objectStore = getSharedObjectStore();
    const meta = await objectStore.head(payload.objectKey).catch(() => null);
    if (!meta) {
      return reply.status(404).send({ code: 'OBJECT_NOT_FOUND', error: '对象不存在或已被清理' });
    }

    // 解析 Range: bytes=start-endInclusive（endInclusive 可省略）
    let range: { start: number; endInclusive: number } | undefined;
    if (typeof rangeHeader === 'string') {
      const m = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader.trim());
      if (m) {
        const start = Number(m[1]);
        const endInclusive = m[2] ? Number(m[2]) : Number(meta.bytes) - 1;
        if (Number.isFinite(start) && Number.isFinite(endInclusive) && start <= endInclusive) {
          range = { start, endInclusive };
        }
      }
    }

    let body;
    try {
      body = await objectStore.get(payload.objectKey, range);
    } catch {
      return reply.status(416).send({ code: 'OBJECT_RANGE_INVALID', error: '请求的字节区间无效' });
    }

    reply.header('Content-Type', meta.mime || 'application/octet-stream');
    reply.header('Accept-Ranges', 'bytes');
    if (meta.etag) reply.header('ETag', meta.etag);
    if (range) {
      reply.status(206);
      reply.header('Content-Range', `bytes ${body.bytesStart}-${body.bytesEndInclusive}/${body.bytesTotal}`);
      reply.header('Content-Length', String(Number(body.bytesEndInclusive) - Number(body.bytesStart) + 1));
    } else {
      reply.header('Content-Length', String(body.bytesTotal));
    }
    return reply.send(Buffer.from(body.bytes));
  });
}
