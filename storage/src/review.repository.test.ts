import { beforeEach, describe, expect, it } from 'vitest';
import { createReviewRepository } from './review.repository.js';
import { createBookRepository } from './book.repository.js';
import { createUserRepository } from './user.repository.js';
import { prisma } from './prisma.js';
import { testPrisma } from './test-setup.js';
import { testUserInput } from './test-fixtures.js';

describe('ReviewRepository.findByCharacterIds', () => {
  const repo = createReviewRepository(testPrisma);
  const bookRepo = createBookRepository(testPrisma);
  const userRepo = createUserRepository(testPrisma);
  let ownerId: string;
  let characterIds: string[] = [];

  beforeEach(async () => {
    await prisma.characterReview.deleteMany();
    await prisma.character.deleteMany();
    await prisma.book.deleteMany();
    await prisma.user.deleteMany();
    const user = await userRepo.create(testUserInput('reviewrepo@example.com', '审核仓储用户'));
    ownerId = user.id;
    const book = await bookRepo.create({
      title: 'Review Repo Book',
      filePath: '/tmp/review-repo.txt',
      fileSize: 1,
      mimeType: 'text/plain',
      userId: ownerId,
    });
    characterIds = [];
    const baseTime = Date.now();
    for (let i = 0; i < 3; i += 1) {
      const c = await prisma.character.create({
        data: { bookId: book.id, name: `角色${i}`, status: 'PENDING', reviewSource: 'AI' },
      });
      characterIds.push(c.id);
      // 每个角色 2 条审核，回写交错的 createdAt，验证组内倒序
      for (let j = 0; j < 2; j += 1) {
        const created = await repo.create({
          characterId: c.id,
          userId: ownerId,
          action: 'APPROVE',
        });
        await prisma.characterReview.update({
          where: { id: created.id },
          data: { createdAt: new Date(baseTime + (j + 1) * 60_000 + i * 1_000) },
        });
      }
    }
  });

  it('空列表不发起查询，直接返回空数组', async () => {
    await expect(repo.findByCharacterIds([])).resolves.toEqual([]);
  });

  it('批量返回全部角色的审核，且组内保持 createdAt 倒序', async () => {
    const rows = await repo.findByCharacterIds(characterIds);
    expect(rows).toHaveLength(6);
    const byCharacter = new Map<string, typeof rows>();
    for (const row of rows) {
      const bucket = byCharacter.get(row.characterId) ?? [];
      bucket.push(row);
      byCharacter.set(row.characterId, bucket);
    }
    expect(byCharacter.size).toBe(3);
    for (const bucket of byCharacter.values()) {
      expect(bucket).toHaveLength(2);
      expect(bucket[0].createdAt.getTime()).toBeGreaterThanOrEqual(bucket[1].createdAt.getTime());
    }
  });

  it('只返回请求的角色，不串其他角色的审核', async () => {
    const rows = await repo.findByCharacterIds([characterIds[0]]);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.characterId === characterIds[0])).toBe(true);
  });
});
