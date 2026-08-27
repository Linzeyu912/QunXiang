import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../app.js';
import { prisma } from '@qunxiang/storage';
import { testUserInput } from '../../../storage/src/test-fixtures.js';

const ORIGIN = 'http://localhost:5173';

let dbAvailable = false;
await Promise.race([
  prisma.$queryRaw`SELECT 1`.then(() => { dbAvailable = true; }, () => { dbAvailable = false; }),
  new Promise((resolve) => setTimeout(resolve, 3000)),
]);

describe.runIf(dbAvailable)('统一审核与乐观锁（实施包 E1/E2）', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let userId: string;
  let token: string;
  let bookId: string;
  let characterId: string;

  const headers = () => ({
    authorization: `Bearer ${token}`,
    origin: ORIGIN,
    'content-type': 'application/json',
  });

  beforeAll(async () => {
    process.env.JWT_SECRET = 'entity-reviews-test-secret';
    process.env.LLM_PROVIDER = 'mock';
    process.env.NODE_ENV = 'test';
    process.env.ALLOWED_ORIGINS = ORIGIN;
    process.env.OBJECT_STORAGE_SIGN_SECRET = 'reviews-sign-secret';
    app = await buildApp({ logger: false });

    const suffix = randomUUID();
    const user = await prisma.user.create({ data: testUserInput(`reviews-${suffix}@test.local`) });
    userId = user.id;
    token = app.jwt.sign({ userId: user.id, email: user.email, name: user.name });
    bookId = (await prisma.book.create({
      data: { title: '审核测试', filePath: `D:/tmp/${suffix}.txt`, fileSize: 1, mimeType: 'text/plain', userId },
    })).id;
    characterId = (await prisma.character.create({
      data: { bookId, name: '测试角色', confidence: 0.9, chapterAppearances: [1], mentionCount: 2 },
    })).id;
  });

  afterAll(async () => {
    if (userId) {
      await prisma.book.deleteMany({ where: { userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    }
    if (app) await app.close();
  });

  it('1. 人工通过后统一审核历史可查（按书/按实体）', async () => {
    const approve = await app.inject({
      method: 'PATCH', url: `/characters/${characterId}`, headers: headers(),
      payload: JSON.stringify({ status: 'APPROVED' }),
    });
    expect(approve.statusCode, approve.body).toBe(200);
    expect(approve.json().enrichmentAvailable).toBe(true);

    const byBook = await app.inject({
      method: 'GET', url: `/books/${bookId}/entity-reviews`, headers: headers(),
    });
    expect(byBook.statusCode).toBe(200);
    const reviews = byBook.json().reviews as Array<{ action: string; entityType: string; actorType: string }>;
    expect(reviews.length).toBeGreaterThanOrEqual(1);
    expect(reviews[0].action).toBe('APPROVE');
    expect(reviews[0].entityType).toBe('character');
    expect(reviews[0].actorType).toBe('USER');

    const byEntity = await app.inject({
      method: 'GET', url: `/books/${bookId}/entity-reviews?entityType=character&entityId=${characterId}`, headers: headers(),
    });
    expect(byEntity.statusCode).toBe(200);
    expect((byEntity.json().reviews as unknown[]).length).toBeGreaterThanOrEqual(1);
  });

  it('2. 审核统计接口返回分类计数', async () => {
    const res = await app.inject({
      method: 'GET', url: `/books/${bookId}/entity-reviews/summary`, headers: headers(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { total: number; byAction: Record<string, number>; byEntityType: Record<string, number> };
    expect(body.total).toBeGreaterThanOrEqual(1);
    expect(body.byAction.APPROVE).toBeGreaterThanOrEqual(1);
    expect(body.byEntityType.character).toBeGreaterThanOrEqual(1);
  });

  it('3. PATCH 携带过期 expectedVersion 返回 409', async () => {
    const conflict = await app.inject({
      method: 'PATCH', url: `/characters/${characterId}`, headers: headers(),
      payload: JSON.stringify({ description: '新描述', expectedVersion: 999 }),
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error).toContain('请刷新后重试');
  });

  it('4. PATCH 携带正确 expectedVersion 成功', async () => {
    const current = await prisma.character.findUnique({ where: { id: characterId } });
    const ok = await app.inject({
      method: 'PATCH', url: `/characters/${characterId}`, headers: headers(),
      payload: JSON.stringify({ description: '带版本号的更新', expectedVersion: current?.version ?? 1 }),
    });
    expect(ok.statusCode, ok.body).toBe(200);
  });
});
