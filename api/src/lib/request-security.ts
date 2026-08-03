import type { FastifyRequest } from 'fastify';

export class RequestSecurityError extends Error {}

export function assertTrustedMutation(request: FastifyRequest, allowed: Set<string>) {
  const origin = request.headers.origin;
  if (!origin || !allowed.has(origin)) {
    throw new RequestSecurityError('请求来源不受信任');
  }
}

export function assertCsrfHeader(request: FastifyRequest) {
  if (request.headers['x-csrf-token'] !== '1') {
    throw new RequestSecurityError('缺少安全校验信息');
  }
}
