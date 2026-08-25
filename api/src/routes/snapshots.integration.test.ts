import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../app.js';
import { BOOK_NOT_FOUND_BODY } from '../lib/api-errors.js';
import {
  prisma,
  getSharedObjectStore,
  createFsDownloadToken,
  verifyFsDownloadToken,
} from '@qunxiang/storage';
import { testUserInput } from '../../../storage/src/test-fixtures.js';

const ORIGIN = 'http://localhost:5173';
const SIGN_SECRET = process.env.OBJECT_STORAGE_SIGN_SECRET ?? 'test-object-storage-sign-secret';

describe('快照与下载路由（C1）', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let ownerId: string;
  let otherOwnerId: string;
  let token: string;
  let otherToken: string;
  let bookId: string;
  let otherBookId: string;
  let sourceObjectKey: string;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'snapshots-integration-test-secret';
    process.env.LLM_PROVIDER = 'mock';
    process.env.NODE_ENV = 'test';
    process.env.ALLOWED_ORIGINS = ORIGIN;
    // 强制使用 FS 对象存储：本测试覆盖 FsObjectStore 的 HMAC 下载令牌路径
    // （/objects/dl?t=...）。S3 预签名由 createDownloadUrl 直接返回远端地址，
    // 不经过内部下载路由。
    process.env.OBJECT_STORAGE_PROVIDER = 'fs';
    process.env.OBJECT_STORAGE_SIGN_SECRET = SIGN_SECRET;
    process.env.OBJECT_STORAGE_FS_ROOT = await mkdtemp(join(tmpdir(), 'snap-int-'));

    app = await buildApp({ logger: false });

    const suffix = randomUUID();
    const user = await prisma.user.create({ data: testUserInput(`snap-owner-${suffix}@test`, '所有者') });
    const other = await prisma.user.create({ data: testUserInput(`snap-other-${suffix}@test`, '他人') });
    ownerId = user.id;
    otherOwnerId = other.id;
    token = app.jwt.sign({ userId: user.id, email: user.email, name: user.name });
    otherToken = app.jwt.sign({ userId: other.id, email: other.email, name: other.name });

    // 写一个真实对象作为书籍原文来源
    const sourceBuf = Buffer.from('第一章 启程\n少年推开木门，踏上青山古道。\n', 'utf-8');
    const stored = await getSharedObjectStore().put({ body: sourceBuf, mime: 'text/plain' });
    sourceObjectKey = stored.objectKey;

    const book = await prisma.book.create({
      data: {
        title: '快照测试书',
        filePath: '',
        fileSize: sourceBuf.byteLength,
        mimeType: 'text/plain',
        userId: ownerId,
        sourceObjectKey,
      },
    });
    bookId = book.id;
    const otherBook = await prisma.book.create({
      data: {
        title: '他人书',
        filePath: '',
        fileSize: 1,
        mimeType: 'text/plain',
        userId: otherOwnerId,
        sourceObjectKey,
      },
    });
    otherBookId = otherBook.id;
  });

  afterAll(async () => {
    await Promise.all([
      bookId ? rm(join('output', bookId), { recursive: true, force: true }) : Promise.resolve(),
      otherBookId ? rm(join('output', otherBookId), { recursive: true, force: true }) : Promise.resolve(),
    ]);
    const userIds = [ownerId, otherOwnerId].filter((id): id is string => Boolean(id));
    if (userIds.length) {
      await prisma.assetSnapshot.deleteMany({ where: { ownerId: { in: userIds } } });
      await prisma.book.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    if (app) await app.close();
  });

  const authHeaders = (mutation = false) => ({
    authorization: `Bearer ${token}`,
    ...(mutation ? { origin: ORIGIN } : {}),
  });

  const otherHeaders = (mutation = false) => ({
    authorization: `Bearer ${otherToken}`,
    ...(mutation ? { origin: ORIGIN } : {}),
  });

  describe('GET /books/:id/download-state', () => {
    it('无快照返回 not-prepared', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/books/${bookId}/download-state`,
        headers: authHeaders(),
      } as never);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ state: 'not-prepared' });
    });

    it('不存在或他人的书统一 404（不泄露存在性）', async () => {
      const foreignRes = await app.inject({
        method: 'GET',
        url: `/books/${otherBookId}/download-state`,
        headers: authHeaders(),
      } as never);
      const missingRes = await app.inject({
        method: 'GET',
        url: `/books/00000000-0000-4000-8000-000000000099/download-state`,
        headers: authHeaders(),
      } as never);
      expect(foreignRes.statusCode).toBe(404);
      expect(missingRes.statusCode).toBe(404);
      expect(foreignRes.json()).toEqual(BOOK_NOT_FOUND_BODY);
      expect(missingRes.json()).toEqual(BOOK_NOT_FOUND_BODY);
    });

    it('building 快照返回 preparing', async () => {
      const snap = await prisma.assetSnapshot.create({
        data: {
          bookId,
          ownerId,
          version: 1,
          contentRevision: 'rev-test-building',
          status: 'building',
        },
      });
      await prisma.book.update({ where: { id: bookId }, data: { currentSnapshotId: snap.id } });
      const res = await app.inject({
        method: 'GET',
        url: `/books/${bookId}/download-state`,
        headers: authHeaders(),
      } as never);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ state: 'preparing', snapshotVersion: 1 });
    });
  });

  describe('POST /books/:id/snapshots', () => {
    it('创建快照并入队 asset-snapshot 任务', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/books/${bookId}/snapshots`,
        headers: authHeaders(true),
      } as never);
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.snapshotId).toBeTruthy();
      // 入队任务存在
      const job = await prisma.backgroundJob.findFirst({
        where: { kind: 'asset-snapshot', payload: { path: ['snapshotId'], equals: body.snapshotId } },
      });
      expect(job).toBeTruthy();
      expect(job!.status).toBe('pending');
    });

    it('他人的书 404', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/books/${otherBookId}/snapshots`,
        headers: authHeaders(true),
      } as never);
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual(BOOK_NOT_FOUND_BODY);
    });
  });

  describe('GET /books/:id/snapshots/:snapshotId', () => {
    it('返回脱敏摘要', async () => {
      const snap = await prisma.assetSnapshot.create({
        data: {
          bookId,
          ownerId,
          version: 9,
          contentRevision: 'rev-summary-' + randomUUID(),
          status: 'ready',
          readyAt: new Date(),
        },
      });
      const res = await app.inject({
        method: 'GET',
        url: `/books/${bookId}/snapshots/${snap.id}`,
        headers: authHeaders(),
      } as never);
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.version).toBe(9);
      expect(body.status).toBe('ready');
      // 不含敏感字段
      expect(JSON.stringify(body)).not.toContain('objectKey');
      expect(body).not.toHaveProperty('archiveObjectId');
    });

    it('他人快照 404', async () => {
      const ownSnap = await prisma.assetSnapshot.findFirst({ where: { bookId, ownerId } });
      if (!ownSnap) throw new Error('需要先有快照');
      const res = await app.inject({
        method: 'GET',
        url: `/books/${bookId}/snapshots/${ownSnap.id}`,
        headers: otherHeaders(),
      } as never);
      expect(res.statusCode).toBe(404);
    });
  });

  describe('POST /books/:id/snapshots/:snapshotId/download-authorizations', () => {
    it('未 ready/未打包 返回中文错误', async () => {
      const snap = await prisma.assetSnapshot.findFirst({ where: { bookId, ownerId, status: 'building' } });
      if (!snap) throw new Error('需要先有 building 快照');
      const res = await app.inject({
        method: 'POST',
        url: `/books/${bookId}/snapshots/${snap.id}/download-authorizations`,
        headers: authHeaders(true),
      } as never);
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect(res.json().error).toMatch(/尚未准备完成|未准备|失败/);
    });

    it('ready + archive 返回签名 URL（URL 不入库）', async () => {
      // 写一个 ZIP 对象 + AssetObject
      const archiveBuf = Buffer.from('fake-zip-bytes', 'utf-8');
      const stored = await getSharedObjectStore().put({ body: archiveBuf, mime: 'application/zip' });
      const assetObj = await prisma.assetObject.create({
        data: {
          sha256: stored.sha256,
          bytes: stored.bytes,
          mime: 'application/zip',
          objectKey: stored.objectKey,
          etag: stored.etag,
        },
      });
      const snap = await prisma.assetSnapshot.create({
        data: {
          bookId,
          ownerId,
          version: 11,
          contentRevision: 'rev-auth-' + randomUUID(),
          status: 'ready',
          readyAt: new Date(),
          manifestObjectId: assetObj.id,
          archiveObjectId: assetObj.id,
        },
      });
      const res = await app.inject({
        method: 'POST',
        url: `/books/${bookId}/snapshots/${snap.id}/download-authorizations`,
        headers: authHeaders(true),
      } as never);
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.url).toContain('/objects/dl');
      expect(body.bytes).toBeGreaterThan(0);
      expect(body.expiresAt).toBeTruthy();
      // 签名 URL 不入日志/DB（粗略校验：响应只是单次返回）
      // 这里至少验证响应中没有 objectKey
      expect(JSON.stringify(body)).not.toContain(stored.objectKey);
    });

    it('他人快照 404', async () => {
      const ownSnap = await prisma.assetSnapshot.findFirst({ where: { bookId, ownerId, status: 'ready' } });
      if (!ownSnap) throw new Error('需要先有 ready 快照');
      const res = await app.inject({
        method: 'POST',
        url: `/books/${bookId}/snapshots/${ownSnap.id}/download-authorizations`,
        headers: otherHeaders(true),
      } as never);
      expect(res.statusCode).toBe(404);
    });
  });

  describe('GET /objects/dl（签名下载）', () => {
    it('合法 token 返回对象字节并支持 Range 头', async () => {
      const buf = Buffer.from('0123456789abcdef', 'utf-8');
      const stored = await getSharedObjectStore().put({ body: buf, mime: 'application/octet-stream' });
      const expiresAt = new Date(Date.now() + 60_000);
      const tokenStr = createFsDownloadToken(stored.objectKey, expiresAt, SIGN_SECRET);
      const res = await app.inject({
        method: 'GET',
        url: `/objects/dl?t=${tokenStr}`,
      } as never);
      expect(res.statusCode).toBe(200);
      expect(res.body).toBe(buf.toString('utf-8'));
      expect(res.headers['accept-ranges']).toBeDefined();

      // Range
      const rangeRes = await app.inject({
        method: 'GET',
        url: `/objects/dl?t=${tokenStr}`,
        headers: { range: 'bytes=2-5' },
      } as never);
      expect(rangeRes.statusCode).toBe(206);
      expect(rangeRes.body).toBe(buf.slice(2, 6).toString('utf-8'));
      expect(rangeRes.headers['content-range']).toContain('2-5');
    });

    it('篡改 token 返回 401 中文错误', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/objects/dl?t=bogus.token`,
      } as never);
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toMatch(/过期|无效|非法|篡改|不合法/);
    });

    it('过期 token 返回 401 中文错误', async () => {
      const buf = Buffer.from('expired', 'utf-8');
      const stored = await getSharedObjectStore().put({ body: buf, mime: 'application/octet-stream' });
      const expiredAt = new Date(Date.now() - 60_000);
      const tokenStr = createFsDownloadToken(stored.objectKey, expiredAt, SIGN_SECRET);
      const res = await app.inject({
        method: 'GET',
        url: `/objects/dl?t=${tokenStr}`,
      } as never);
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toMatch(/过期|无效|非法|不合法/);
    });

    it('缺少 token 参数 401', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/objects/dl`,
      } as never);
      expect(res.statusCode).toBe(401);
    });
  });

  it('verifyFsDownloadToken 与签名端点共享同一 secret', () => {
    const objectKey = 'obj/aa/bb/' + 'a'.repeat(64);
    const expiresAt = new Date(Date.now() + 60_000);
    const tokenStr = createFsDownloadToken(objectKey, expiresAt, SIGN_SECRET);
    const payload = verifyFsDownloadToken(tokenStr, SIGN_SECRET, new Date());
    expect(payload).not.toBeNull();
    expect(payload!.objectKey).toBe(objectKey);
  });
});
