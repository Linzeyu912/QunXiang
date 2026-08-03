import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from './prisma.js';
import { createRefreshSessionRepository } from './refresh-session.repository.js';
import { testUserInput } from './test-fixtures.js';

const repo = createRefreshSessionRepository(prisma);
const TEST_DOMAIN = '@refresh-session.repository.test';

describe('刷新会话仓储', () => {
  beforeEach(async () => {
    const users = await prisma.user.findMany({
      where: { emailNormalized: { endsWith: TEST_DOMAIN } },
      select: { id: true },
    });
    await prisma.refreshSession.deleteMany({
      where: { userId: { in: users.map(({ id }) => id) } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: users.map(({ id }) => id) } },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function createUser(prefix: string) {
    return prisma.user.create({
      data: testUserInput(`${prefix}${TEST_DOMAIN}`, '刷新会话测试用户'),
    });
  }

  it('并发轮换只有一个成功，旧令牌重放会撤销整个 family', async () => {
    const user = await createUser('concurrent');
    const familyId = randomUUID();
    const tokenHash = '1'.repeat(64);
    const now = new Date('2026-07-15T08:00:00.000Z');
    const session = await repo.createSession({
      userId: user.id,
      familyId,
      tokenHash,
      expiresAt: new Date('2026-08-14T08:00:00.000Z'),
    });

    const results = await Promise.allSettled([
      repo.rotateSession({
        sessionId: session.id,
        tokenHash,
        nextTokenHash: 'a'.repeat(64),
        nextExpiresAt: new Date('2026-08-14T08:01:00.000Z'),
        now,
      }),
      repo.rotateSession({
        sessionId: session.id,
        tokenHash,
        nextTokenHash: 'b'.repeat(64),
        nextExpiresAt: new Date('2026-08-14T08:01:00.000Z'),
        now,
      }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    await expect(repo.rotateSession({
      sessionId: session.id,
      tokenHash,
      nextTokenHash: 'c'.repeat(64),
      nextExpiresAt: new Date('2026-08-14T08:02:00.000Z'),
      now: new Date('2026-07-15T08:02:00.000Z'),
    })).rejects.toThrow('刷新令牌已被使用');
    expect(await repo.countActiveFamily(familyId, new Date('2026-07-15T08:02:00.000Z'))).toBe(0);
  });

  it('过期会话不可轮换', async () => {
    const user = await createUser('expired');
    const tokenHash = '2'.repeat(64);
    const session = await repo.createSession({
      userId: user.id,
      familyId: randomUUID(),
      tokenHash,
      expiresAt: new Date('2026-07-14T08:00:00.000Z'),
    });

    await expect(repo.rotateSession({
      sessionId: session.id,
      tokenHash,
      nextTokenHash: 'd'.repeat(64),
      nextExpiresAt: new Date('2026-08-14T08:00:00.000Z'),
      now: new Date('2026-07-15T08:00:00.000Z'),
    })).rejects.toThrow('刷新会话已过期');
  });

  it('可以撤销当前会话、整个 family 和用户全部会话', async () => {
    const user = await createUser('revoke');
    const familyA = randomUUID();
    const familyB = randomUUID();
    const expiresAt = new Date('2026-08-14T08:00:00.000Z');
    const now = new Date('2026-07-15T08:00:00.000Z');
    const first = await repo.createSession({ userId: user.id, familyId: familyA, tokenHash: '3'.repeat(64), expiresAt });
    await repo.createSession({ userId: user.id, familyId: familyA, tokenHash: '4'.repeat(64), expiresAt });
    await repo.createSession({ userId: user.id, familyId: familyB, tokenHash: '5'.repeat(64), expiresAt });

    expect(await repo.revokeCurrent(first.id, now)).toBe(true);
    expect(await repo.revokeFamily(familyA, now)).toBe(1);
    expect(await repo.revokeAllForUser(user.id, now)).toBe(1);
    expect(await repo.countActiveFamily(familyA, now)).toBe(0);
    expect(await repo.countActiveFamily(familyB, now)).toBe(0);
  });
});
