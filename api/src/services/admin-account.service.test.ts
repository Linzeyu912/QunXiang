import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@qunxiang/storage';
import { createShareCode } from '../lib/share-code.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { refreshTokenHash } from '../lib/refresh-token.js';
import { resetUserPasswordByAdmin } from './admin-account.service.js';

const TEST_DOMAIN = '@admin-reset.service.test';

describe('管理员本机重置密码', () => {
  beforeEach(async () => {
    const users = await prisma.user.findMany({
      where: { emailNormalized: { endsWith: TEST_DOMAIN } },
      select: { id: true },
    });
    const userIds = users.map(({ id }) => id);
    await prisma.auditLog.deleteMany({ where: { targetId: { in: userIds } } });
    await prisma.refreshSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('修改密码、撤销全部会话并写入不含敏感信息的审计记录', async () => {
    const email = `target${TEST_DOMAIN}`;
    const oldPassword = '旧安全密码123';
    const newPassword = '新安全密码456';
    const refreshToken = '不得进入审计记录的刷新令牌';
    const shareCode = createShareCode();
    const oldPasswordHash = await hashPassword(oldPassword);
    const user = await prisma.user.create({
      data: {
        email,
        emailNormalized: email,
        name: '管理员重置测试用户',
        passwordHash: oldPasswordHash,
        shareCodeHash: shareCode.hash,
      },
    });
    await prisma.refreshSession.createMany({
      data: [
        {
          userId: user.id,
          familyId: randomUUID(),
          tokenHash: refreshTokenHash(refreshToken),
          expiresAt: new Date(Date.now() + 86_400_000),
        },
        {
          userId: user.id,
          familyId: randomUUID(),
          tokenHash: 'f'.repeat(64),
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      ],
    });

    const result = await resetUserPasswordByAdmin({
      email,
      newPassword,
      actorId: 'local-cli',
    });

    expect(result).toEqual({ userId: user.id, revokedSessionCount: 2 });
    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await verifyPassword(newPassword, updated.passwordHash)).toBe(true);
    expect(await verifyPassword(oldPassword, updated.passwordHash)).toBe(false);
    expect(updated.passwordHash).not.toBe(oldPasswordHash);

    const activeSessions = await prisma.refreshSession.count({
      where: { userId: user.id, revokedAt: null },
    });
    expect(activeSessions).toBe(0);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { targetId: user.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).toEqual(expect.objectContaining({
      actorType: 'LOCAL_ADMIN',
      actorId: 'local-cli',
      action: 'ACCOUNT_PASSWORD_RESET',
      targetType: 'USER',
      targetId: user.id,
    }));
    const metadata = JSON.stringify(audit.metadata);
    expect(metadata).not.toContain(email);
    expect(metadata).not.toContain(oldPassword);
    expect(metadata).not.toContain(newPassword);
    expect(metadata).not.toContain(oldPasswordHash);
    expect(metadata).not.toContain(updated.passwordHash);
    expect(metadata).not.toContain(refreshToken);
    expect(metadata).not.toMatch(/password|token|email|hash/i);
  });

  it('未知账号返回中文错误且不写审计记录', async () => {
    await expect(resetUserPasswordByAdmin({
      email: `missing${TEST_DOMAIN}`,
      newPassword: '新安全密码456',
    })).rejects.toThrow('账号不存在');
    expect(await prisma.auditLog.count({
      where: { action: 'ACCOUNT_PASSWORD_RESET', targetId: { contains: TEST_DOMAIN } },
    })).toBe(0);
  });
});
