import type { FastifyInstance } from 'fastify';
import { UserRepository, RefreshSessionRepository, prisma } from '@qunxiang/storage';
import { createShareCode } from '../lib/share-code.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { REFRESH_COOKIE_NAME, REFRESH_COOKIE_OPTIONS } from '../config/auth.js';
import { refreshTokenHash } from '../lib/refresh-token.js';
import { assertCsrfHeader } from '../lib/request-security.js';
import { invalidateUserCache } from '../lib/user-cache.js';

/** 会话行（不含原始 IP——H1 规则：原始 IP 不落库，设备摘要按令牌族区分）。 */
interface SessionRow {
  id: string;
  familyId: string;
  createdAt: Date;
  rotatedAt: Date | null;
  expiresAt: Date;
}

export async function accountRoutes(fastify: FastifyInstance) {
  fastify.post('/share-code/rotate', async (request, reply) => {
    // 与同文件其他会话敏感操作保持一致的 CSRF 头校验
    try {
      assertCsrfHeader(request);
    } catch {
      return reply.status(403).send({ error: '缺少必要的安全校验头，请刷新页面后重试' });
    }
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

  // ── 账号基础能力（实施包 H1）──

  // 修改资料：本轮只允许改名称，不改邮箱
  fastify.patch('/profile', async (request, reply) => {
    try {
      assertCsrfHeader(request);
    } catch {
      return reply.status(403).send({ error: '缺少必要的安全校验头，请刷新页面后重试' });
    }
    const body = (request.body ?? {}) as { name?: unknown };
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 40) {
      return reply.status(400).send({ error: '名称不能为空且不超过 40 个字符' });
    }
    const user = await prisma.user.update({
      where: { id: request.user.userId },
      data: { name },
      select: { id: true, email: true, name: true },
    });
    // 立即失效鉴权缓存，避免后续请求的 request.user.name 滞后 15 秒
    invalidateUserCache(user.id);
    return { user };
  });

  // 修改密码：需当前密码；成功后撤销全部会话并要求重新登录
  fastify.post('/change-password', async (request, reply) => {
    try {
      assertCsrfHeader(request);
    } catch {
      return reply.status(403).send({ error: '缺少必要的安全校验头，请刷新页面后重试' });
    }
    const body = (request.body ?? {}) as { currentPassword?: unknown; newPassword?: unknown };
    const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
    if (!currentPassword || !newPassword) {
      return reply.status(400).send({ error: '请提供当前密码与新密码' });
    }
    if (newPassword.length < 8) {
      return reply.status(400).send({ error: '新密码至少 8 位' });
    }

    const user = await UserRepository.findById(request.user.userId);
    if (!user) return reply.status(401).send({ error: '登录状态已失效，请重新登录' });

    const ok = await verifyPassword(currentPassword, user.passwordHash).catch(() => false);
    if (!ok) return reply.status(403).send({ error: '当前密码不正确' });

    await UserRepository.updatePasswordHash(user.id, await hashPassword(newPassword));
    // 撤销全部会话，清除刷新 Cookie，要求重新登录
    await RefreshSessionRepository.revokeAllForUser(user.id);
    // 改密后失效鉴权缓存；管理员 CLI 重置走独立进程，无法触达本进程缓存，由 TTL 兜底
    invalidateUserCache(user.id);
    reply.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_OPTIONS.path });
    return { ok: true, message: '密码已修改，全部会话已撤销，请重新登录' };
  });

  // 会话列表：显示设备摘要（当前/其他）与最后活动时间；不返回原始 IP
  fastify.get('/sessions', async (request) => {
    const cookieToken = request.cookies[REFRESH_COOKIE_NAME];
    const currentHash = cookieToken ? refreshTokenHash(cookieToken) : null;
    const rows = (await prisma.refreshSession.findMany({
      where: { userId: request.user.userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })) as SessionRow[];
    const currentId = currentHash
      ? (await prisma.refreshSession.findUnique({ where: { tokenHash: currentHash } }))?.id
      : null;
    return {
      sessions: rows.map((row) => ({
        id: row.id,
        deviceSummary: row.id === currentId ? '当前设备' : `其他会话（${row.familyId.slice(0, 8)}）`,
        createdAt: row.createdAt,
        lastActiveAt: row.rotatedAt ?? row.createdAt,
        expiresAt: row.expiresAt,
        isCurrent: row.id === currentId,
      })),
    };
  });

  // 撤销指定会话
  fastify.delete('/sessions/:sessionId', async (request, reply) => {
    try {
      assertCsrfHeader(request);
    } catch {
      return reply.status(403).send({ error: '缺少必要的安全校验头，请刷新页面后重试' });
    }
    const { sessionId } = request.params as { sessionId: string };
    const session = await prisma.refreshSession.findFirst({
      where: { id: sessionId, userId: request.user.userId },
    });
    if (!session || session.revokedAt) {
      return reply.status(404).send({ error: '会话不存在或已撤销' });
    }
    await RefreshSessionRepository.revokeFamily(session.familyId);
    return { ok: true };
  });

  // 撤销除当前会话外的全部会话
  fastify.delete('/sessions/others', async (request, reply) => {
    try {
      assertCsrfHeader(request);
    } catch {
      return reply.status(403).send({ error: '缺少必要的安全校验头，请刷新页面后重试' });
    }
    const cookieToken = request.cookies[REFRESH_COOKIE_NAME];
    const currentHash = cookieToken ? refreshTokenHash(cookieToken) : null;
    const current = currentHash
      ? await prisma.refreshSession.findUnique({ where: { tokenHash: currentHash } })
      : null;
    const rows = await prisma.refreshSession.findMany({
      where: { userId: request.user.userId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, familyId: true },
    });
    let revoked = 0;
    for (const row of rows) {
      if (current && row.familyId === current.familyId) continue;
      await RefreshSessionRepository.revokeFamily(row.familyId);
      revoked += 1;
    }
    return { ok: true, revoked };
  });
}
