import type { FastifyReply } from 'fastify';

export const BOOK_NOT_FOUND_BODY = Object.freeze({
  code: 'BOOK_NOT_FOUND',
  error: '书籍不存在或无权访问',
});

export const AUTH_REQUIRED_BODY = Object.freeze({
  code: 'AUTH_REQUIRED',
  error: '请先登录',
});

export function sendBookNotFound(reply: FastifyReply) {
  return reply.status(404).send(BOOK_NOT_FOUND_BODY);
}
