import type { FastifyInstance } from 'fastify';
import { UserRepository } from '@novel-agent/storage';
import { hashPassword, verifyPassword } from '../lib/password.js';

/** 返回给前端的用户对象（剔除 passwordHash）。 */
function toPublicUser(user: {
  id: string;
  email: string;
  name: string;
  passwordHash?: string | null;
}) {
  return { id: user.id, email: user.email, name: user.name };
}

function signToken(fastify: FastifyInstance, user: { id: string; email: string; name: string }) {
  return fastify.jwt.sign({ userId: user.id, email: user.email, name: user.name });
}

export async function authRoutes(fastify: FastifyInstance) {
  fastify.post('/register', async (request, reply) => {
    const { email, password, name } = request.body as {
      email?: string;
      password?: string;
      name?: string;
    };

    if (!email || !password || !name) {
      return reply.status(400).send({ error: 'email, password, and name are required' });
    }
    if (password.length < 6) {
      return reply.status(400).send({ error: '密码至少 6 位' });
    }

    const existing = await UserRepository.findByEmail(email);
    if (existing) {
      return reply.status(409).send({ error: '该邮箱已注册' });
    }

    const user = await UserRepository.create({
      email,
      name,
      passwordHash: hashPassword(password),
    });

    const token = signToken(fastify, user);
    return { token, user: toPublicUser(user) };
  });

  fastify.post('/login', async (request, reply) => {
    const { email, password } = request.body as { email?: string; password?: string };

    if (!email || !password) {
      return reply.status(400).send({ error: 'email and password are required' });
    }

    const user = await UserRepository.findByEmail(email);
    // 统一返回模糊错误，避免枚举已注册邮箱
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return reply.status(401).send({ error: '邮箱或密码错误' });
    }

    const token = signToken(fastify, user);
    return { token, user: toPublicUser(user) };
  });

  // 由 onRequest 钩子保证已鉴权；返回当前用户。
  fastify.get('/me', async (request) => {
    const user = await UserRepository.findById(request.user.userId);
    if (!user) {
      return { user: { id: request.user.userId, email: request.user.email, name: request.user.name } };
    }
    return { user: toPublicUser(user) };
  });

  // 用有效 token 换发新 token（滑动续期）。
  fastify.post('/refresh', async (request, reply) => {
    try {
      const user = await UserRepository.findById(request.user.userId);
      if (!user) {
        return reply.status(401).send({ error: '用户不存在' });
      }
      const token = signToken(fastify, user);
      return { token, user: toPublicUser(user) };
    } catch {
      return reply.status(401).send({ error: '登录已过期' });
    }
  });
}
