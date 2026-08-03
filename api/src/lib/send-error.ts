import type { FastifyReply } from 'fastify';

/**
 * 统一路由错误处理：记录原始错误到日志，返回不泄露内部细节的中文友好消息。
 *
 * - Zod 校验错误 → 400
 * - 数据库繁忙 → 503
 * - 其他 → 500
 *
 * 原始 err.message 只写日志，不返回给客户端（避免泄露 Prisma SQL 错误等内部信息）。
 * 如果 err.message 含中文（后端主动抛出的友好提示），则透传。
 */
export function sendServerError(
  reply: FastifyReply,
  err: unknown,
  log?: { error: (msg: unknown) => void }
): FastifyReply {
  if (log) log.error(err);

  const message = err instanceof Error ? err.message : String(err);

  // Zod 校验错误
  if (err && typeof err === 'object' && 'name' in err && err.name === 'ZodError') {
    return reply.status(400).send({ error: '请求数据格式不正确' });
  }

  // 数据库繁忙
  if (/SQLITE_BUSY|database.*locked|connection.*timeout/i.test(message)) {
    return reply.status(503).send({ error: '数据库繁忙，请稍后重试' });
  }

  // 后端主动抛出的中文友好提示 → 透传
  const hasChinese = /[\u4e00-\u9fff]/.test(message);
  if (hasChinese) {
    return reply.status(500).send({ error: message });
  }

  // 兜底：不泄露英文内部错误
  return reply.status(500).send({ error: '服务器内部错误，请稍后重试' });
}
