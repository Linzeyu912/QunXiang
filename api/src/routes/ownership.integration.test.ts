import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildApp } from '../app.js';
import { BOOK_NOT_FOUND_BODY } from '../lib/api-errors.js';
import { prisma } from '@qunxiang/storage';
import { testUserInput } from '../../../storage/src/test-fixtures.js';

const ORIGIN = 'http://localhost:5173';

describe('公开路由所有权矩阵', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let ownerA: string;
  let ownerB: string;
  let tokenA: string;
  let bookA: string;
  let bookB: string;
  let characterB: string;
  let locationB: string;
  let itemB: string;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'ownership-integration-test-secret';
    process.env.LLM_PROVIDER = 'mock';
    process.env.NODE_ENV = 'test';
    process.env.ALLOWED_ORIGINS = ORIGIN;
    app = await buildApp({ logger: false });

    const suffix = randomUUID();
    const userA = await prisma.user.create({ data: testUserInput(`owner-a-${suffix}@ownership.test`, '用户甲') });
    const userB = await prisma.user.create({ data: testUserInput(`owner-b-${suffix}@ownership.test`, '用户乙') });
    ownerA = userA.id;
    ownerB = userB.id;
    tokenA = app.jwt.sign({ userId: userA.id, email: userA.email, name: userA.name });
    bookA = (await prisma.book.create({
      data: { title: '用户甲的书', filePath: `D:/tmp/${suffix}-a.txt`, fileSize: 1, mimeType: 'text/plain', userId: ownerA },
    })).id;
    const foreignBook = await prisma.book.create({
      data: { title: '用户乙的书', filePath: `D:/tmp/${suffix}.txt`, fileSize: 1, mimeType: 'text/plain', userId: ownerB },
    });
    bookB = foreignBook.id;
    characterB = (await prisma.character.create({
      data: { bookId: bookB, name: '乙角色', aliases: [], confidence: 1 },
    })).id;
    locationB = (await prisma.location.create({
      data: { bookId: bookB, name: '乙场景', aliases: [], confidence: 1 },
    })).id;
    itemB = (await prisma.item.create({
      data: { bookId: bookB, name: '乙道具', aliases: [], confidence: 1 },
    })).id;
  });

  afterAll(async () => {
    await Promise.all([
      bookA ? rm(join('output', bookA), { recursive: true, force: true }) : Promise.resolve(),
      bookB ? rm(join('output', bookB), { recursive: true, force: true }) : Promise.resolve(),
    ]);
    const userIds = [ownerA, ownerB].filter((id): id is string => Boolean(id));
    if (userIds.length > 0) {
      await prisma.book.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    if (app) await app.close();
  });

  const headers = (mutation = false) => ({
    authorization: `Bearer ${tokenA}`,
    ...(mutation ? { origin: ORIGIN } : {}),
  });

  async function expectSameHiddenResponse(
    foreign: { method: string; url: string; payload?: unknown },
    missing: { method: string; url: string; payload?: unknown },
  ) {
    const [foreignResponse, missingResponse] = await Promise.all([
      app.inject({ ...foreign, headers: headers(foreign.method !== 'GET') } as never),
      app.inject({ ...missing, headers: headers(missing.method !== 'GET') } as never),
    ]);
    expect(foreignResponse.statusCode).toBe(404);
    expect(missingResponse.statusCode).toBe(404);
    expect(foreignResponse.json()).toEqual(BOOK_NOT_FOUND_BODY);
    expect(missingResponse.json()).toEqual(BOOK_NOT_FOUND_BODY);
  }

  it.each([
    ['books GET', '/books/:id'],
    ['characters GET', '/characters?bookId=:id'],
    ['locations GET', '/locations?bookId=:id'],
    ['items GET', '/items?bookId=:id'],
    ['items GET by category', '/items?bookId=:id&category=weapon'],
    ['worldview GET', '/worldview?bookId=:id'],
    ['extract GET', '/books/:id/extract/stages'],
    ['export GET', '/export/:id'],
    ['images GET', '/books/:id/images/character/test'],
    ['stories GET', '/books/:id/stories'],
    ['director GET', '/books/:id/director/assignments'],
    ['artifacts GET', '/books/:id/extraction-artifacts'],
  ])('%s 对越权和不存在返回完全相同的中文 404', async (_name, template) => {
    await expectSameHiddenResponse(
      { method: 'GET', url: template.replace(':id', bookB) },
      { method: 'GET', url: template.replace(':id', randomUUID()) },
    );
  });

  it.each([
    ['books DELETE', 'DELETE', 'book', '/books/:id', undefined],
    ['characters PATCH', 'PATCH', 'character', '/characters/:id', { status: 'APPROVED' }],
    ['locations PATCH', 'PATCH', 'location', '/locations/:id', { status: 'APPROVED' }],
    ['items PATCH', 'PATCH', 'item', '/items/:id', { status: 'APPROVED' }],
    ['extract POST', 'POST', 'book', '/books/:id/extract', {}],
    ['images POST', 'POST', 'book', '/books/:id/images/character/test', {}],
    ['stories POST', 'POST', 'book', '/books/:id/stories/segment', {}],
    ['director POST', 'POST', 'book', '/books/:id/director/assignments', { assignmentType: 'single_story', objective: 'draft_script', storyIds: ['story-1'] }],
    ['artifacts POST', 'POST', 'book', '/books/:id/chapters/noise/restore', { lineNum: 1 }],
  ])('%s mutation 对越权和不存在返回完全相同的中文 404', async (_name, method, resource, template, payload) => {
    const foreignId = resource === 'character' ? characterB : resource === 'location' ? locationB : resource === 'item' ? itemB : bookB;
    await expectSameHiddenResponse(
      { method, url: template.replace(':id', foreignId), payload },
      { method, url: template.replace(':id', randomUUID()), payload },
    );
  });

  it('缺少 bearer 时统一返回中文 401', async () => {
    const response = await app.inject({ method: 'GET', url: '/books' });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ code: 'AUTH_REQUIRED', error: '请先登录' });
  });

  it('所有者可以用单条 owner-scoped 写入找回噪声行', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/books/${bookA}/chapters/noise/restore`,
      headers: headers(true),
      payload: { lineNum: 7 },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(await prisma.noiseOverride.count({ where: { bookId: bookA, lineNum: 7 } })).toBe(1);
  });

  it('编码斜杠不能让 storyId 越界读取其他账号的故事资产', async () => {
    const victimDir = join('output', bookB, 'stories', 'story-victim');
    await mkdir(victimDir, { recursive: true });
    await writeFile(join(victimDir, 'asset-pack.json'), JSON.stringify({
      bookId: bookB,
      storyId: 'story-victim',
      secret: '用户乙的故事资产',
    }), 'utf8');

    const traversal = encodeURIComponent(`../../${bookB}/stories/story-victim`);
    const response = await app.inject({
      method: 'GET',
      url: `/books/${bookA}/stories/${traversal}/assets`,
      headers: headers(),
    });

    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain('用户乙的故事资产');
  });
});
