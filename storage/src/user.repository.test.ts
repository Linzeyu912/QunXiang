import { describe, it, expect, beforeEach } from 'vitest';
import { createUserRepository, type UserRepository } from './user.repository.js';
import { testPrisma } from './test-setup.js';
import { testUserInput } from './test-fixtures.js';
import { randomUUID } from 'node:crypto';

describe('UserRepository', () => {
  let repo: UserRepository;

  beforeEach(async () => {
    repo = createUserRepository(testPrisma);
    await testPrisma.user.deleteMany();
  });

  describe('create', () => {
    it('创建账号时保存完整认证字段', async () => {
      const user = await repo.create(testUserInput('test@example.com', '测试用户'));

      expect(user.email).toBe('test@example.com');
      expect(user.name).toBe('测试用户');
      expect(user.emailNormalized).toBe('test@example.com');
      expect(user.passwordHash).toBeTruthy();
      expect(user.shareCodeHash).toHaveLength(64);
      expect(user.id).toBeDefined();
      expect(user.createdAt).toBeInstanceOf(Date);
    });

    it('should generate a unique id for each user', async () => {
      const user1 = await repo.create(testUserInput('user1@example.com', '用户一'));
      const user2 = await repo.create(testUserInput('user2@example.com', '用户二'));

      expect(user1.id).not.toBe(user2.id);
    });
  });

  describe('findById', () => {
    it('should find a user by id', async () => {
      const created = await repo.create(testUserInput('find@example.com', '待查用户'));
      const found = await repo.findById(created.id);

      expect(found).not.toBeNull();
      expect(found?.email).toBe('find@example.com');
    });

    it('should return null when user does not exist', async () => {
      const found = await repo.findById(randomUUID());
      expect(found).toBeNull();
    });
  });

  describe('findByEmail', () => {
    it('should find a user by email', async () => {
      await repo.create(testUserInput('unique@example.com', '唯一用户'));
      const found = await repo.findByEmail('unique@example.com');

      expect(found).not.toBeNull();
      expect(found?.name).toBe('唯一用户');
    });

    it('should return null when email does not exist', async () => {
      const found = await repo.findByEmail('nonexistent@example.com');
      expect(found).toBeNull();
    });
  });

  it('按规范化邮箱查询', async () => {
    await repo.create(testUserInput('Case@Test.Example', '大小写用户'));
    const found = await repo.findByEmail('  case@test.example  ');
    expect(found?.name).toBe('大小写用户');
  });

  it('轮换分享码摘要', async () => {
    const user = await repo.create(testUserInput('rotate@example.com', '轮换用户'));
    const nextHash = 'ab'.repeat(32);
    const updated = await repo.updateShareCodeHash(user.id, nextHash);
    expect(updated.shareCodeHash).toBe(nextHash);
    expect((await repo.findById(user.id))?.shareCodeHash).toBe(nextHash);
  });

  it('注册账号与首个刷新会话任一步失败时整体回滚', async () => {
    const existing = await repo.create(testUserInput('session-owner@example.com', '会话占用用户'));
    const duplicateTokenHash = 'cd'.repeat(32);
    await testPrisma.refreshSession.create({
      data: {
        userId: existing.id,
        familyId: randomUUID(),
        tokenHash: duplicateTokenHash,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    await expect(repo.createWithRefreshSession(
      testUserInput('atomic-register@example.com', '原子注册用户'),
      {
        familyId: randomUUID(),
        tokenHash: duplicateTokenHash,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    )).rejects.toMatchObject({ code: 'P2002' });
    expect(await repo.findByEmail('atomic-register@example.com')).toBeNull();
  });
});
