import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../app.js';
import { prisma, getSharedObjectStore } from '@qunxiang/storage';
import { setRuntimeProvider } from '@qunxiang/llm';
import { testUserInput } from '../../../storage/src/test-fixtures.js';

const ORIGIN = 'http://localhost:5173';

// 模块级 DB 可用性探测
let dbAvailable = false;
await Promise.race([
  prisma.$queryRaw`SELECT 1`.then(
    () => { dbAvailable = true; },
    () => { dbAvailable = false; },
  ),
  new Promise((resolve) => setTimeout(resolve, 3000)),
]);

describe.runIf(dbAvailable)('公共素材库路由', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let publisherId: string;
  let takerId: string;
  let publisherToken: string;
  let takerToken: string;
  let bookId: string;
  let takerBookId: string;
  let characterId: string;
  let pendingCharacterId: string;
  let assetId: string;
  let objectKey: string;

  async function authFetch(token: string, path: string, opts: RequestInit = {}) {
    const res = await app.inject({
      method: (opts.method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE') ?? 'GET',
      url: path,
      headers: {
        authorization: `Bearer ${token}`,
        origin: ORIGIN,
        ...(opts.body ? { 'content-type': 'application/json' } : {}),
      },
      payload: opts.body as string | undefined,
    });
    return { status: res.statusCode, body: res.json() as Record<string, unknown> };
  }

  beforeAll(async () => {
    process.env.JWT_SECRET = 'public-assets-integration-test-secret';
    process.env.LLM_PROVIDER = 'mock';
    process.env.NODE_ENV = 'test';
    process.env.ALLOWED_ORIGINS = ORIGIN;
    process.env.OBJECT_STORAGE_PROVIDER = 'fs';
    process.env.OBJECT_STORAGE_SIGN_SECRET = process.env.OBJECT_STORAGE_SIGN_SECRET ?? 'test-object-storage-sign-secret-pa';
    process.env.OBJECT_STORAGE_FS_ROOT = await mkdtemp(join(tmpdir(), 'pa-int-'));
    app = await buildApp({ logger: false });
    // buildApp 内 loadPersistedConfig 可能从磁盘加载真实模型配置，
    // 强制切回 mock：chatExtract 返回结构不匹配 → 标签识别确定性降级到关键词规则
    setRuntimeProvider('mock');

    const suffix = randomUUID();
    const publisher = await prisma.user.create({ data: testUserInput(`pub-${suffix}@test`, '发布者') });
    const taker = await prisma.user.create({ data: testUserInput(`taker-${suffix}@test`, '拿取者') });
    publisherId = publisher.id;
    takerId = taker.id;
    publisherToken = app.jwt.sign({ userId: publisher.id, email: publisher.email, name: publisher.name });
    takerToken = app.jwt.sign({ userId: taker.id, email: taker.email, name: taker.name });

    // 建书
    const stored = await getSharedObjectStore().put({ body: Buffer.from('测试书'), mime: 'text/plain' });
    const book = await prisma.book.create({
      data: { title: '测试书', filePath: '', fileSize: 4, mimeType: 'text/plain', userId: publisherId, sourceObjectKey: stored.objectKey },
    });
    bookId = book.id;

    const takerBook = await prisma.book.create({
      data: { title: '拿取者书', filePath: '', fileSize: 4, mimeType: 'text/plain', userId: takerId },
    });
    takerBookId = takerBook.id;

    // 建一个 APPROVED 实体 + 图片（upsert 避免多次跑测试时同 objectKey 冲突）
    const storedImg = await getSharedObjectStore().put({ body: Buffer.from('fake-png-data'), mime: 'image/png' });
    objectKey = storedImg.objectKey;
    const assetObj = await prisma.assetObject.upsert({
      where: { objectKey },
      create: { sha256: randomUUID(), bytes: BigInt(12), mime: 'image/png', objectKey },
      update: {},
    });

    const char = await prisma.character.create({
      data: {
        bookId,
        name: '韩立',
        aliases: ['韩老魔'],
        description: '一个普通的少年，相貌平平，皮肤黝黑。',
        confidence: 0.9,
        status: 'APPROVED',
      },
    });
    characterId = char.id;

    await prisma.entityImage.create({
      data: {
        bookId,
        entityType: 'character',
        entityName: '韩立',
        filePath: '',
        objectKey,
        mime: 'image/png',
        ext: 'png',
        bytes: 12,
        source: 'generated',
        isPrimary: true,
      },
    });

    // 建一个 PENDING 实体（不应可发布）
    const pendingChar = await prisma.character.create({
      data: {
        bookId,
        name: '待审核角色',
        confidence: 0.5,
        status: 'PENDING',
      },
    });
    pendingCharacterId = pendingChar.id;

    void assetObj;
  });

  afterAll(async () => {
    await app?.close();
    if (process.env.OBJECT_STORAGE_FS_ROOT?.includes('pa-int-')) {
      await rm(process.env.OBJECT_STORAGE_FS_ROOT, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('1. 发布 APPROVED 实体成功', async () => {
    const { status, body } = await authFetch(publisherToken, '/public-assets', {
      method: 'POST',
      body: JSON.stringify({
        bookId,
        entityType: 'character',
        entityId: characterId,
        tags: ['古风', '少年'],
        showSource: true,
      }),
    });
    expect(status).toBe(200);
    expect(body.id).toBeTruthy();
    assetId = body.id as string;
  });

  it('2. 发布 PENDING 实体被拒绝', async () => {
    const { status, body } = await authFetch(publisherToken, '/public-assets', {
      method: 'POST',
      body: JSON.stringify({
        bookId,
        entityType: 'character',
        entityId: pendingCharacterId,
      }),
    });
    expect(status).toBe(400);
    expect((body.error as string)).toContain('审核通过');
  });

  it('3. 浏览公共池：发布者发布的素材可见', async () => {
    const { status, body } = await authFetch(takerToken, '/public-assets?kind=character');
    expect(status).toBe(200);
    const items = body.items as Array<Record<string, unknown>>;
    expect(items.length).toBeGreaterThan(0);
    const found = items.find((i) => i.id === assetId);
    expect(found).toBeTruthy();
    expect(found!.name).toBe('韩立');
    expect(found!.primaryImageUrl).toBeTruthy();
  });

  it('4. 详情：payload 和图片 URL 完整', async () => {
    const { status, body } = await authFetch(takerToken, `/public-assets/${assetId}`);
    expect(status).toBe(200);
    expect(body.name).toBe('韩立');
    expect(body.payload).toBeTruthy();
    expect(body.publisherName).toBe('发布者');
    expect(Array.isArray(body.images)).toBe(true);
    expect((body.images as unknown[]).length).toBeGreaterThan(0);
    const img = (body.images as Array<Record<string, unknown>>)[0];
    expect(img.url).toContain('/objects/dl');
  });

  it('5. 拿取：实体以 PENDING 进入目标书 + takenCount+1', async () => {
    const { status, body } = await authFetch(takerToken, `/public-assets/${assetId}/take`, {
      method: 'POST',
      body: JSON.stringify({ targetBookId: takerBookId }),
    });
    expect(status).toBe(200);
    expect(body.entityName).toBe('韩立');

    // 验证目标书有 PENDING 实体
    const char = await prisma.character.findFirst({
      where: { bookId: takerBookId, name: '韩立' },
    });
    expect(char).toBeTruthy();
    expect(char!.status).toBe('PENDING');

    // 验证 takenCount +1
    const asset = await prisma.publicAsset.findUnique({ where: { id: assetId } });
    expect(asset!.takenCount).toBe(1);
  });

  it('6. 拿取：名称冲突自动加后缀', async () => {
    // 先在拿取者书里建一个同名角色
    await prisma.character.create({
      data: { bookId: takerBookId, name: '王林', confidence: 0.5, status: 'APPROVED' },
    });

    // 发布一个名为"王林"的素材（用另一本书）
    const book2 = await prisma.book.create({
      data: { title: '第二本书', filePath: '', fileSize: 4, mimeType: 'text/plain', userId: publisherId },
    });
    const char2 = await prisma.character.create({
      data: { bookId: book2.id, name: '王林', confidence: 0.9, status: 'APPROVED' },
    });
    const pub2 = await authFetch(publisherToken, '/public-assets', {
      method: 'POST',
      body: JSON.stringify({ bookId: book2.id, entityType: 'character', entityId: char2.id }),
    });
    const asset2Id = pub2.body.id as string;

    const { status, body } = await authFetch(takerToken, `/public-assets/${asset2Id}/take`, {
      method: 'POST',
      body: JSON.stringify({ targetBookId: takerBookId }),
    });
    expect(status).toBe(200);
    expect((body.entityName as string)).toContain('公共库');

    const taken = await prisma.character.findFirst({
      where: { bookId: takerBookId, name: { contains: '公共库' } },
    });
    expect(taken).toBeTruthy();
  });

  it('7. 拿取：重复拿取到同一本书返回提示', async () => {
    const { status, body } = await authFetch(takerToken, `/public-assets/${assetId}/take`, {
      method: 'POST',
      body: JSON.stringify({ targetBookId: takerBookId }),
    });
    expect(status).toBe(409);
    expect((body.code as string)).toBe('ALREADY_TAKEN');
  });

  it('8. 下架：仅发布者可操作', async () => {
    // 拿取者尝试下架 → 404
    const takerResult = await authFetch(takerToken, `/public-assets/${assetId}/unlist`, {
      method: 'POST',
    });
    expect(takerResult.status).toBe(404);

    // 发布者下架成功
    const { status } = await authFetch(publisherToken, `/public-assets/${assetId}/unlist`, {
      method: 'POST',
    });
    expect(status).toBe(200);

    // 下架后浏览不可见
    const { body } = await authFetch(takerToken, '/public-assets?kind=character');
    const items = body.items as Array<Record<string, unknown>>;
    expect(items.find((i) => i.id === assetId)).toBeUndefined();

    // 详情也 404
    const detailRes = await authFetch(takerToken, `/public-assets/${assetId}`);
    expect(detailRes.status).toBe(404);
  });

  it('9. 引用计数：发布后 AssetObject.countReferences 包含 PublicAssetImage', async () => {
    // 发布的素材有图片引用，AssetObject 应有引用计数
    const assetObj = await prisma.assetObject.findFirst({
      where: { objectKey },
      include: { publicAssetImages: true },
    });
    expect(assetObj).toBeTruthy();
    // 被下架了，但 PublicAssetImage 仍然存在（只是 PublicAsset.status=unlisted）
    expect(assetObj!.publicAssetImages.length).toBeGreaterThan(0);
  });

  it('10. 我的发布列表含已下架', async () => {
    const { status, body } = await authFetch(publisherToken, '/public-assets/mine');
    expect(status).toBe(200);
    const items = body.items as Array<Record<string, unknown>>;
    const found = items.find((i) => i.id === assetId);
    expect(found).toBeTruthy();
    expect(found!.status).toBe('unlisted');
  });

  // ── 多标签筛选 + 标签聚合 ──
  let genreAssetA: string;
  let genreAssetB: string;

  it('11. 发布带题材标签的素材（玄幻+仙侠）', async () => {
    const { status, body } = await authFetch(publisherToken, '/public-assets', {
      method: 'POST',
      body: JSON.stringify({
        bookId,
        entityType: 'character',
        entityId: characterId,
        tags: ['玄幻', '仙侠', '剑修'],
        showSource: true,
      }),
    });
    expect(status).toBe(200);
    genreAssetA = body.id as string;
  });

  it('12. 发布带题材标签的素材（玄幻+都市）', async () => {
    const { status, body } = await authFetch(publisherToken, '/public-assets', {
      method: 'POST',
      body: JSON.stringify({
        bookId,
        entityType: 'character',
        entityId: characterId,
        tags: ['玄幻', '都市'],
      }),
    });
    expect(status).toBe(200);
    genreAssetB = body.id as string;
  });

  it('13. 多标签筛选：tags=玄幻 同时匹配两个素材', async () => {
    const { status, body } = await authFetch(
      takerToken,
      '/public-assets?tags=%E7%8E%84%E5%B9%BB',
    );
    expect(status).toBe(200);
    const items = body.items as Array<Record<string, unknown>>;
    const ids = items.map((i) => i.id);
    expect(ids).toContain(genreAssetA);
    expect(ids).toContain(genreAssetB);
  });

  it('14. 多标签筛选：tags=玄幻&tags=仙侠 AND 逻辑只匹配 A', async () => {
    const { status, body } = await authFetch(
      takerToken,
      '/public-assets?tags=%E7%8E%84%E5%B9%BB&tags=%E4%BB%99%E4%BE%A0',
    );
    expect(status).toBe(200);
    const items = body.items as Array<Record<string, unknown>>;
    const ids = items.map((i) => i.id);
    expect(ids).toContain(genreAssetA);
    expect(ids).not.toContain(genreAssetB);
  });

  it('15. 多标签筛选：tags=玄幻&tags=都市 AND 逻辑只匹配 B', async () => {
    const { status, body } = await authFetch(
      takerToken,
      '/public-assets?tags=%E7%8E%84%E5%B9%BB&tags=%E9%83%BD%E5%B8%82',
    );
    expect(status).toBe(200);
    const items = body.items as Array<Record<string, unknown>>;
    const ids = items.map((i) => i.id);
    expect(ids).toContain(genreAssetB);
    expect(ids).not.toContain(genreAssetA);
  });

  it('16. 热门标签聚合：GET /tags 返回正确计数', async () => {
    const { status, body } = await authFetch(takerToken, '/public-assets/tags');
    expect(status).toBe(200);
    const items = body.items as Array<{ tag: string; count: number }>;
    expect(items.length).toBeGreaterThan(0);

    const xuanhuan = items.find((t) => t.tag === '玄幻');
    expect(xuanhuan).toBeTruthy();
    expect(xuanhuan!.count).toBeGreaterThanOrEqual(2);

    const xianxia = items.find((t) => t.tag === '仙侠');
    expect(xianxia).toBeTruthy();
    expect(xianxia!.count).toBeGreaterThanOrEqual(1);
  });

  // ── 标签智能识别（mock provider 返回结构不匹配 → 降级关键词规则） ──

  it('17. 标签识别：简介含题材关键词时返回初步题材（关键词兜底）', async () => {
    const xianXiuChar = await prisma.character.create({
      data: {
        bookId,
        name: '测试修仙角色',
        description: '七玄门弟子，筑基期剑修，一心求道盼飞升',
        confidence: 0.9,
        status: 'APPROVED',
      },
    });

    const { status, body } = await authFetch(publisherToken, '/public-assets/suggest-tags', {
      method: 'POST',
      body: JSON.stringify({ bookId, entityType: 'character', entityId: xianXiuChar.id }),
    });
    expect(status).toBe(200);
    expect(body.source).toBe('rule');
    expect(body.genres as string[]).toContain('仙侠');
    expect((body.genres as string[]).length).toBeLessThanOrEqual(2);
    expect((body.message as string)).toContain('关键词');
  });

  it('18. 标签识别：无关键词命中返回空结果与提示', async () => {
    const { status, body } = await authFetch(publisherToken, '/public-assets/suggest-tags', {
      method: 'POST',
      body: JSON.stringify({ bookId, entityType: 'character', entityId: characterId }),
    });
    expect(status).toBe(200);
    expect(body.source).toBe('none');
    expect(body.genres).toEqual([]);
    expect(body.tags).toEqual([]);
    expect((body.message as string)).toBeTruthy();
  });

  it('19. 标签识别：非本人实体返回 404', async () => {
    const { status } = await authFetch(takerToken, '/public-assets/suggest-tags', {
      method: 'POST',
      body: JSON.stringify({ bookId, entityType: 'character', entityId: characterId }),
    });
    expect(status).toBe(404);
  });
});
