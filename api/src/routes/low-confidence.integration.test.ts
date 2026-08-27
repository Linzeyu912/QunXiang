import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../app.js';
import { prisma } from '@qunxiang/storage';
import { testUserInput } from '../../../storage/src/test-fixtures.js';

// 模块级 DB 可用性探测
let dbAvailable = false;
await Promise.race([
  prisma.$queryRaw`SELECT 1`.then(
    () => { dbAvailable = true; },
    () => { dbAvailable = false; },
  ),
  new Promise((resolve) => setTimeout(resolve, 3000)),
]);

describe.runIf(dbAvailable)('低置信度库路由', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let userId: string;
  let token: string;
  let bookId: string;
  let highId: string;
  let lowId: string;
  let lowApprovedId: string;
  let lowRejectedId: string;

  const headers = () => ({ authorization: `Bearer ${token}` });

  beforeAll(async () => {
    process.env.JWT_SECRET = 'low-confidence-integration-test-secret';
    process.env.LLM_PROVIDER = 'mock';
    process.env.NODE_ENV = 'test';
    process.env.ALLOWED_ORIGINS = 'http://localhost:5173';
    process.env.OBJECT_STORAGE_SIGN_SECRET = 'low-confidence-sign-secret-pa';
    app = await buildApp({ logger: false });

    const suffix = randomUUID();
    const user = await prisma.user.create({ data: testUserInput(`low-conf-${suffix}@test.local`) });
    userId = user.id;
    token = app.jwt.sign({ userId: user.id, email: user.email, name: user.name });
    bookId = (await prisma.book.create({
      data: { title: '低置信度测试', filePath: `D:/tmp/${suffix}.txt`, fileSize: 1, mimeType: 'text/plain', userId },
    })).id;

    // 高置信度：应出现在主列表
    highId = (await prisma.character.create({
      data: { bookId, name: '高置信度角色', confidence: 0.9, chapterAppearances: [1], mentionCount: 5 },
    })).id;
    // 低置信度待审核：只应出现在低置信度库
    lowId = (await prisma.character.create({
      data: { bookId, name: '低置信度角色', confidence: 0.5, chapterAppearances: [2], mentionCount: 1 },
    })).id;
    // 低置信度但已通过人工审核：应留在主列表
    lowApprovedId = (await prisma.character.create({
      data: { bookId, name: '已通过的次要角色', confidence: 0.4, status: 'APPROVED', chapterAppearances: [3], mentionCount: 2 },
    })).id;
    // 低置信度且已被拒绝：只应出现在已拒绝列表
    lowRejectedId = (await prisma.character.create({
      data: { bookId, name: '已拒绝的次要角色', confidence: 0.3, status: 'REJECTED', chapterAppearances: [4], mentionCount: 1 },
    })).id;
  });

  afterAll(async () => {
    if (userId) {
      await prisma.book.deleteMany({ where: { userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    }
    if (app) await app.close();
  });

  async function getCharacterIds(url: string): Promise<string[]> {
    const res = await app.inject({ method: 'GET', url, headers: headers() });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json().characters as Array<{ id: string }>).map((c) => c.id);
  }

  it('1. 主列表默认排除低置信度待审核实体，保留高置信度与已通过实体', async () => {
    const ids = await getCharacterIds(`/characters?bookId=${bookId}`);
    expect(ids).toContain(highId);
    expect(ids).toContain(lowApprovedId);
    expect(ids).not.toContain(lowId);
  });

  it('2. confidence=low 只返回低置信度待审核实体', async () => {
    const ids = await getCharacterIds(`/characters?bookId=${bookId}&confidence=low`);
    expect(ids).toEqual([lowId]);
  });

  it('3. 低置信度实体通过后进入主列表并离开低置信度库', async () => {
    const patch = await app.inject({
      method: 'PATCH',
      url: `/characters/${lowId}`,
      headers: { ...headers(), origin: 'http://localhost:5173', 'content-type': 'application/json' },
      payload: JSON.stringify({ status: 'APPROVED' }),
    });
    expect(patch.statusCode).toBe(200);

    const mainIds = await getCharacterIds(`/characters?bookId=${bookId}`);
    expect(mainIds).toContain(lowId);
    const lowIds = await getCharacterIds(`/characters?bookId=${bookId}&confidence=low`);
    expect(lowIds).not.toContain(lowId);
  });

  it('4. 被拒绝的低置信度实体不再返回低置信度库，只出现在已拒绝列表', async () => {
    const lowIds = await getCharacterIds(`/characters?bookId=${bookId}&reviewBucket=LOW_CONFIDENCE`);
    expect(lowIds).not.toContain(lowRejectedId);
    const rejectedIds = await getCharacterIds(`/characters?bookId=${bookId}&reviewBucket=REJECTED`);
    expect(rejectedIds).toEqual([lowRejectedId]);
  });

  it('5. 被拒绝实体不出现在主列表，三集合互斥且计数一致', async () => {
    const mainIds = await getCharacterIds(`/characters?bookId=${bookId}&reviewBucket=MAIN`);
    const lowIds = await getCharacterIds(`/characters?bookId=${bookId}&reviewBucket=LOW_CONFIDENCE`);
    const rejectedIds = await getCharacterIds(`/characters?bookId=${bookId}&reviewBucket=REJECTED`);
    // 三集合两两不相交
    const all = [...mainIds, ...lowIds, ...rejectedIds];
    expect(new Set(all).size).toBe(all.length);
    expect(mainIds).not.toContain(lowRejectedId);

    const res = await app.inject({ method: 'GET', url: `/characters?bookId=${bookId}&reviewBucket=MAIN`, headers: headers() });
    expect(res.statusCode, res.body).toBe(200);
    const counts = res.json().counts as { MAIN: number; LOW_CONFIDENCE: number; REJECTED: number };
    expect(counts.MAIN).toBe(mainIds.length);
    expect(counts.LOW_CONFIDENCE).toBe(lowIds.length);
    expect(counts.REJECTED).toBe(rejectedIds.length);
  });

  it('6. 世界观纳入统一审核集合查询', async () => {
    await prisma.worldviewSetting.create({
      data: { bookId, name: '低置信度体系', confidence: 0.3, category: 'power-system' },
    });
    const approvedWv = await prisma.worldviewSetting.create({
      data: { bookId, name: '已通过体系', confidence: 0.9, status: 'APPROVED', category: 'worldview' },
    });
    const lowRes = await app.inject({ method: 'GET', url: `/worldview?bookId=${bookId}&reviewBucket=LOW_CONFIDENCE`, headers: headers() });
    expect(lowRes.statusCode).toBe(200);
    const lowNames = (lowRes.json().worldviews as Array<{ name: string }>).map((w) => w.name);
    expect(lowNames).toContain('低置信度体系');
    expect(lowNames).not.toContain('已通过体系');
    const mainRes = await app.inject({ method: 'GET', url: `/worldview?bookId=${bookId}&reviewBucket=MAIN`, headers: headers() });
    expect(mainRes.statusCode).toBe(200);
    const mainIds = (mainRes.json().worldviews as Array<{ id: string }>).map((w) => w.id);
    expect(mainIds).toContain(approvedWv.id);
    expect(mainRes.json().counts.LOW_CONFIDENCE).toBe(lowNames.length);
  });
});
