import type { FastifyInstance } from 'fastify';
import { UserRepository } from '@novel-agent/storage';
import { createShareCode } from '../lib/share-code.js';

export async function accountRoutes(fastify: FastifyInstance) {
  fastify.post('/share-code/rotate', async (request, reply) => {
    const user = await UserRepository.findById(request.user.userId);
    if (!user) {
      return reply.status(401).send({ error: '登录状态已失效，请重新登录' });
    }
    if (user.status !== 'ACTIVE') {
      return reply.status(403).send({ error: '账号已停用，请联系管理员' });
    }

    const shareCode = createShareCode();
    await UserRepository.updateShareCodeHash(user.id, shareCode.hash);
    reply.header('Cache-Control', 'no-store');
    return { shareCode: shareCode.plain };
  });
}
