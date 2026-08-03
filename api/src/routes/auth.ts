import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { RefreshSessionRepository, UserRepository } from '@novel-agent/storage';
import {
  REFRESH_COOKIE_NAME,
  REFRESH_COOKIE_OPTIONS,
  REFRESH_SESSION_TTL_MS,
} from '../config/auth.js';
import { normalizeEmail } from '../lib/email.js';
import { verifyLoginCredentials } from '../lib/login-credentials.js';
import { hashPassword } from '../lib/password.js';
import { createRefreshToken, refreshTokenHash } from '../lib/refresh-token.js';
import { assertCsrfHeader, RequestSecurityError } from '../lib/request-security.js';
import { createShareCode } from '../lib/share-code.js';
import { provisionSeedLibrary } from '../services/library-seed.service.js';

interface SessionUser {
  id: string;
  email: string;
  name: string;
}

function toPublicUser(user: SessionUser) {
  return { id: user.id, email: user.email, name: user.name };
}

function signToken(fastify: FastifyInstance, user: SessionUser) {
  return fastify.jwt.sign({ userId: user.id, email: user.email, name: user.name });
}

function clearRefreshCookie(reply: FastifyReply) {
  reply.clearCookie(REFRESH_COOKIE_NAME, {
    path: REFRESH_COOKIE_OPTIONS.path,
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
  });
}

async function createRefreshSession(reply: FastifyReply, userId: string) {
  const token = createRefreshToken();
  await RefreshSessionRepository.createSession({
    userId,
    familyId: randomUUID(),
    tokenHash: refreshTokenHash(token),
    expiresAt: new Date(Date.now() + REFRESH_SESSION_TTL_MS),
  });
  reply.setCookie(REFRESH_COOKIE_NAME, token, REFRESH_COOKIE_OPTIONS);
}

function setRefreshCookie(reply: FastifyReply, token: string) {
  reply.setCookie(REFRESH_COOKIE_NAME, token, REFRESH_COOKIE_OPTIONS);
}

function assertSessionCsrf(request: Parameters<typeof assertCsrfHeader>[0], reply: FastifyReply) {
  try {
    assertCsrfHeader(request);
    return true;
  } catch (error) {
    if (error instanceof RequestSecurityError) {
      reply.status(403).send({ error: error.message });
      return false;
    }
    throw error;
  }
}

export async function authRoutes(fastify: FastifyInstance) {
  fastify.post(
    '/register',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { email, password, name } = request.body as {
        email?: string;
        password?: string;
        name?: string;
      };

      if (!email || !password || !name) {
        return reply.status(400).send({ error: '邮箱、密码和名称均为必填项' });
      }
      if (password.length < 6) {
        return reply.status(400).send({ error: '密码至少 6 位' });
      }

      const emailNormalized = normalizeEmail(email);
      const existing = await UserRepository.findByEmail(emailNormalized);
      if (existing) {
        return reply.status(409).send({ error: '该邮箱已注册' });
      }

      const passwordHash = await hashPassword(password);
      const shareCode = createShareCode();
      const refreshToken = createRefreshToken();
      let user;
      try {
        user = await UserRepository.createWithRefreshSession(
          {
            email: emailNormalized,
            emailNormalized,
            name: name.trim(),
            passwordHash,
            shareCodeHash: shareCode.hash,
          },
          {
            familyId: randomUUID(),
            tokenHash: refreshTokenHash(refreshToken),
            expiresAt: new Date(Date.now() + REFRESH_SESSION_TTL_MS),
          },
        );
      } catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
          return reply.status(409).send({ error: '该邮箱已注册' });
        }
        throw error;
      }

      // 公共书库：把仓库 seed-library/ 的预置书籍物化到新用户名下。
      // 同步等待（保证首次进书架即见书），失败只记日志不阻断注册。
      try {
        await provisionSeedLibrary(user.id);
      } catch (err) {
        request.log.error(err, '公共书库初始化失败');
      }

      setRefreshCookie(reply, refreshToken);
      reply.header('Cache-Control', 'no-store');
      return {
        token: signToken(fastify, user),
        user: toPublicUser(user),
        shareCode: shareCode.plain,
      };
    },
  );

  fastify.post(
    '/login',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { email, password } = request.body as { email?: string; password?: string };
      if (!email || !password) {
        return reply.status(400).send({ error: '邮箱和密码均为必填项' });
      }

      const user = await UserRepository.findByEmail(email);
      const credentialsValid = await verifyLoginCredentials(user, password);
      if (!credentialsValid || !user) {
        return reply.status(401).send({ error: '邮箱或密码错误' });
      }
      if (user.status !== 'ACTIVE') {
        return reply.status(403).send({ error: '账号已停用，请联系管理员' });
      }

      await createRefreshSession(reply, user.id);
      reply.header('Cache-Control', 'no-store');
      return { token: signToken(fastify, user), user: toPublicUser(user) };
    },
  );

  fastify.post('/session/refresh', async (request, reply) => {
    if (!assertSessionCsrf(request, reply)) return;
    const token = request.cookies[REFRESH_COOKIE_NAME];
    if (!token) {
      return reply.status(401).send({ error: '刷新会话无效，请重新登录' });
    }

    const tokenHash = refreshTokenHash(token);
    const current = await RefreshSessionRepository.findByTokenHash(tokenHash);
    if (!current) {
      clearRefreshCookie(reply);
      return reply.status(401).send({ error: '刷新会话无效，请重新登录' });
    }

    const user = await UserRepository.findById(current.userId);
    if (!user) {
      await RefreshSessionRepository.revokeFamily(current.familyId);
      clearRefreshCookie(reply);
      return reply.status(401).send({ error: '登录状态已失效，请重新登录' });
    }
    if (user.status !== 'ACTIVE') {
      await RefreshSessionRepository.revokeAllForUser(user.id);
      clearRefreshCookie(reply);
      return reply.status(403).send({ error: '账号已停用，请联系管理员' });
    }

    const nextToken = createRefreshToken();
    try {
      await RefreshSessionRepository.rotateSession({
        sessionId: current.id,
        tokenHash,
        nextTokenHash: refreshTokenHash(nextToken),
        nextExpiresAt: new Date(Date.now() + REFRESH_SESSION_TTL_MS),
        now: new Date(),
      });
    } catch {
      clearRefreshCookie(reply);
      return reply.status(401).send({ error: '刷新会话无效，请重新登录' });
    }

    reply.setCookie(REFRESH_COOKIE_NAME, nextToken, REFRESH_COOKIE_OPTIONS);
    reply.header('Cache-Control', 'no-store');
    return { token: signToken(fastify, user), user: toPublicUser(user) };
  });

  fastify.post('/session/logout', async (request, reply) => {
    if (!assertSessionCsrf(request, reply)) return;
    const token = request.cookies[REFRESH_COOKIE_NAME];
    if (!token) {
      return reply.status(401).send({ error: '刷新会话无效，请重新登录' });
    }

    const current = await RefreshSessionRepository.findByTokenHash(refreshTokenHash(token));
    if (!current || current.userId !== request.user.userId) {
      clearRefreshCookie(reply);
      return reply.status(401).send({ error: '刷新会话无效，请重新登录' });
    }

    await RefreshSessionRepository.revokeCurrent(current.id);
    clearRefreshCookie(reply);
    return reply.status(204).send();
  });

  fastify.get('/me', async (request, reply) => {
    const user = await UserRepository.findById(request.user.userId);
    if (!user) {
      return reply.status(401).send({ error: '登录状态已失效，请重新登录' });
    }
    if (user.status === 'DISABLED') {
      return reply.status(403).send({ error: '账号已停用，请联系管理员' });
    }
    return { user: toPublicUser(user) };
  });

}
