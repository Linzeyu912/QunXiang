import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../app.js';
import { BOOK_NOT_FOUND_BODY } from '../lib/api-errors.js';
import { prisma, getSharedObjectStore } from '@novel-agent/storage';
import { testUserInput } from '../../../storage/src/test-fixtures.js';
import { copyShareToLibrary } from '../snapshot/book-copy.js';

const ORIGIN = 'http://localhost:5173';

// 模块级 DB 可用性探测：Docker/Postgres 不可用时跳过 E1 集成用例，避免在原 D2 失败之上再叠堆失败。
// pnpm test（带 docker compose）启动时为 true；裸跑 vitest 时为 false。
let e1DbAvailable = false;
await Promise.race([
  prisma.$queryRaw`SELECT 1`.then(
    () => { e1DbAvailable = true; },
    () => { e1DbAvailable = false; },
  ),
  new Promise((resolve) => setTimeout(resolve, 3000)),
]);

describe('分享路由（D2）', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let senderId: string;
  let recipientId: string;
  let otherId: string;
  let senderToken: string;
  let recipientToken: string;
  let otherToken: string;
  let bookId: string;
  let noReadyBookId: string;
  let recipientEmail: string;
  let senderEmail: string;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'shares-integration-test-secret';
    process.env.LLM_PROVIDER = 'mock';
    process.env.NODE_ENV = 'test';
    process.env.ALLOWED_ORIGINS = ORIGIN;
    process.env.OBJECT_STORAGE_PROVIDER = 'fs';
    process.env.OBJECT_STORAGE_SIGN_SECRET = process.env.OBJECT_STORAGE_SIGN_SECRET ?? 'test-object-storage-sign-secret';
    process.env.OBJECT_STORAGE_FS_ROOT = await mkdtemp(join(tmpdir(), 'shares-int-'));
    app = await buildApp({ logger: false });

    const suffix = randomUUID();
    recipientEmail = `rec-${suffix}@test`;
    senderEmail = `sender-${suffix}@test`;
    const sender = await prisma.user.create({ data: testUserInput(senderEmail, '发送者') });
    // recipient 用已知 shareCodeHash = sha256(recipientEmail)，明文码 = recipientEmail
    const recipient = await prisma.user.create({
      data: {
        email: recipientEmail,
        emailNormalized: recipientEmail,
        name: '接收者',
        passwordHash: 'scrypt$00$00',
        status: 'ACTIVE',
        shareCodeHash: createHash('sha256').update(recipientEmail).digest('hex'),
      },
    });
    const other = await prisma.user.create({ data: testUserInput(`other-${suffix}@test`, '他人') });
    senderId = sender.id;
    recipientId = recipient.id;
    otherId = other.id;
    senderToken = app.jwt.sign({ userId: sender.id, email: sender.email, name: sender.name });
    recipientToken = app.jwt.sign({ userId: recipient.id, email: recipient.email, name: recipient.name });
    otherToken = app.jwt.sign({ userId: other.id, email: other.email, name: other.name });

    const stored = await getSharedObjectStore().put({ body: Buffer.from('分享原文'), mime: 'text/plain' });
    const book = await prisma.book.create({
      data: { title: '分享书', filePath: '', fileSize: 4, mimeType: 'text/plain', userId: senderId, sourceObjectKey: stored.objectKey },
    });
    bookId = book.id;
    const archiveObj = await prisma.assetObject.create({
      data: { sha256: createHash('sha256').update(randomUUID()).digest('hex'), bytes: BigInt(4), mime: 'application/zip', objectKey: stored.objectKey },
    });
    const snap = await prisma.assetSnapshot.create({
      data: { bookId, ownerId: senderId, version: 1, contentRevision: randomUUID(), status: 'ready', manifestObjectId: archiveObj.id, archiveObjectId: archiveObj.id, readyAt: new Date() },
    });
    await prisma.$executeRaw`UPDATE "Book" SET "currentSnapshotId" = ${snap.id}::uuid WHERE id = ${bookId}::uuid`;

    // 无 ready 快照的书（用于 409 测试）
    const noReadyBook = await prisma.book.create({
      data: { title: '无快照书', filePath: '', fileSize: 1, mimeType: 'text/plain', userId: senderId, sourceObjectKey: stored.objectKey },
    });
    noReadyBookId = noReadyBook.id;
  });

  afterAll(async () => {
    const userIds = [senderId, recipientId, otherId].filter((id): id is string => Boolean(id));
    if (bookId) await prisma.bookShare.deleteMany({ where: { bookId } }).catch(() => {});
    if (userIds.length) {
      await prisma.assetSnapshot.deleteMany({ where: { ownerId: { in: userIds } } }).catch(() => {});
      await prisma.book.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => {});
    }
    if (app) await app.close();
  });

  const authHeaders = (token: string, mutation = false) => ({
    authorization: `Bearer ${token}`,
    origin: ORIGIN,
    ...(mutation ? { 'x-csrf-token': '1' } : {}),
  });

  it('正确邮箱+分享码创建分享', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/books/${bookId}/shares`,
      headers: authHeaders(senderToken, true),
      payload: { recipientEmail, recipientShareCode: recipientEmail },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().share.status).toBe('active');
  });

  it('重复分享同接收方复用现有', async () => {
    const first = await app.inject({ method: 'POST', url: `/books/${bookId}/shares`, headers: authHeaders(senderToken, true), payload: { recipientEmail, recipientShareCode: recipientEmail } });
    const second = await app.inject({ method: 'POST', url: `/books/${bookId}/shares`, headers: authHeaders(senderToken, true), payload: { recipientEmail, recipientShareCode: recipientEmail } });
    expect(second.json().share.id).toBe(first.json().share.id);
  });

  it('错误分享码统一返回中文失败', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/books/${bookId}/shares`,
      headers: authHeaders(senderToken, true),
      payload: { recipientEmail, recipientShareCode: 'wrong-code' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ code: 'SHARE_FAILED', error: '无法分享给该账号，请核对邮箱和分享码' });
  });

  it('禁止分享给自己', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/books/${bookId}/shares`,
      headers: authHeaders(senderToken, true),
      payload: { recipientEmail: senderEmail, recipientShareCode: senderEmail },
    });
    expect(res.statusCode).toBe(400);
  });

  it('无 ready 快照返回 409', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/books/${noReadyBookId}/shares`,
      headers: authHeaders(senderToken, true),
      payload: { recipientEmail, recipientShareCode: recipientEmail },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('尚无可分享');
  });

  it('他人书创建分享统一 404', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/books/${bookId}/shares`,
      headers: authHeaders(otherToken, true),
      payload: { recipientEmail, recipientShareCode: recipientEmail },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual(BOOK_NOT_FOUND_BODY);
  });

  it('接收方在“分享给我”看到摘要', async () => {
    const res = await app.inject({ method: 'GET', url: '/shares/shared-with-me', headers: authHeaders(recipientToken) });
    expect(res.statusCode).toBe(200);
    const shares = res.json().shares;
    expect(shares.some((s: { bookTitle: string }) => s.bookTitle === '分享书')).toBe(true);
  });

  it('发送者撤销分享', async () => {
    const list = (await app.inject({ method: 'GET', url: '/shares/shared-with-me', headers: authHeaders(senderToken) })).json().shares;
    // 发送者也能经 shared-with-me 看到？不——shared-with-me 是接收方视角。用 DB 查 shareId
    const share = await prisma.bookShare.findFirst({ where: { bookId, recipientId } });
    expect(share).not.toBeNull();
    const res = await app.inject({ method: 'POST', url: `/shares/${share!.id}/revoke`, headers: authHeaders(senderToken, true) });
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
  });
});

// E1：接收方“复制到我的书库”。Docker/Postgres 不可用时整体跳过。
describe.skipIf(!e1DbAvailable)('分享复制（E1）', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let senderId: string;
  let recipientId: string;
  let otherId: string;
  let senderToken: string;
  let recipientToken: string;
  let otherToken: string;
  let bookId: string;
  let snapshotId: string;
  let manifestObjectId: string;
  let archiveObjectId: string;
  let shareId: string;
  let recipientEmail: string;
  let createdUserIds: string[] = [];
  let createdBookIds: string[] = [];
  let fsRoot = '';

  beforeAll(async () => {
    process.env.JWT_SECRET = 'shares-integration-test-secret-e1';
    process.env.LLM_PROVIDER = 'mock';
    process.env.NODE_ENV = 'test';
    process.env.ALLOWED_ORIGINS = ORIGIN;
    process.env.OBJECT_STORAGE_PROVIDER = 'fs';
    process.env.OBJECT_STORAGE_SIGN_SECRET = process.env.OBJECT_STORAGE_SIGN_SECRET ?? 'test-object-storage-sign-secret';
    fsRoot = await mkdtemp(join(tmpdir(), 'shares-e1-'));
    process.env.OBJECT_STORAGE_FS_ROOT = fsRoot;
    app = await buildApp({ logger: false });

    const suffix = randomUUID();
    recipientEmail = `e1-rec-${suffix}@test`;
    const senderEmail = `e1-sender-${suffix}@test`;
    const sender = await prisma.user.create({ data: testUserInput(senderEmail, 'E1发送者') });
    const recipient = await prisma.user.create({
      data: {
        email: recipientEmail,
        emailNormalized: recipientEmail,
        name: 'E1接收者',
        passwordHash: 'scrypt$00$00',
        status: 'ACTIVE',
        shareCodeHash: createHash('sha256').update(recipientEmail).digest('hex'),
      },
    });
    const other = await prisma.user.create({ data: testUserInput(`e1-other-${suffix}@test`, 'E1他人') });
    senderId = sender.id;
    recipientId = recipient.id;
    otherId = other.id;
    createdUserIds = [senderId, recipientId, otherId];

    senderToken = app.jwt.sign({ userId: sender.id, email: sender.email, name: sender.name });
    recipientToken = app.jwt.sign({ userId: recipient.id, email: recipient.email, name: recipient.name });
    otherToken = app.jwt.sign({ userId: other.id, email: other.email, name: other.name });

    // 源书 + ready+archived 快照（含两个对象：source + manifest/archive 同一个）
    const stored = await getSharedObjectStore().put({ body: Buffer.from('E1分享原文'), mime: 'text/plain' });
    const book = await prisma.book.create({
      data: { title: 'E1分享书', filePath: '', fileSize: 4, mimeType: 'text/plain', userId: senderId, sourceObjectKey: stored.objectKey },
    });
    bookId = book.id;
    createdBookIds.push(bookId);
    const sourceObj = await prisma.assetObject.create({
      data: { sha256: createHash('sha256').update('E1分享原文').digest('hex'), bytes: BigInt(4), mime: 'text/plain', objectKey: stored.objectKey },
    });
    archiveObjectId = randomUUID();
    manifestObjectId = randomUUID();
    // 占位 manifest/archive 对象（避免 FK 缺失）
    await prisma.assetObject.create({
      data: { id: archiveObjectId, sha256: createHash('sha256').update(randomUUID()).digest('hex'), bytes: BigInt(1), mime: 'application/zip', objectKey: `obj/fixture-archive-${archiveObjectId}` },
    });
    await prisma.assetObject.create({
      data: { id: manifestObjectId, sha256: createHash('sha256').update(randomUUID()).digest('hex'), bytes: BigInt(1), mime: 'application/json', objectKey: `obj/fixture-manifest-${manifestObjectId}` },
    });
    const snap = await prisma.assetSnapshot.create({
      data: { bookId, ownerId: senderId, version: 1, contentRevision: randomUUID(), status: 'ready', manifestObjectId, archiveObjectId, readyAt: new Date() },
    });
    snapshotId = snap.id;
    await prisma.snapshotObject.create({
      data: { snapshotId, objectId: sourceObj.id, logicalPath: 'source/原始书籍.txt', category: 'source', state: 'present' },
    });
    await prisma.$executeRaw`UPDATE "Book" SET "currentSnapshotId" = ${snap.id}::uuid WHERE id = ${bookId}::uuid`;

    // 创建 active 分享给接收方
    const share = await prisma.bookShare.create({
      data: { bookId, snapshotId, senderId, recipientId, status: 'active' },
    });
    shareId = share.id;
  });

  afterAll(async () => {
    // 清理接收方复制产生的目标书（独立于源书）
    const targetBooks = await prisma.book.findMany({ where: { userId: recipientId } });
    for (const b of targetBooks) {
      await prisma.snapshotObject.deleteMany({ where: { snapshot: { bookId: b.id } } }).catch(() => {});
      await prisma.assetSnapshot.deleteMany({ where: { bookId: b.id } }).catch(() => {});
    }
    await prisma.book.deleteMany({ where: { userId: recipientId } }).catch(() => {});

    if (shareId) await prisma.bookShare.deleteMany({ where: { id: shareId } }).catch(() => {});
    for (const bid of createdBookIds) {
      await prisma.snapshotObject.deleteMany({ where: { snapshot: { bookId: bid } } }).catch(() => {});
      await prisma.assetSnapshot.deleteMany({ where: { bookId: bid } }).catch(() => {});
    }
    await prisma.book.deleteMany({ where: { id: { in: createdBookIds } } }).catch(() => {});
    if (createdUserIds.length) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } }).catch(() => {});
    }
    if (app) await app.close();
    if (fsRoot) await rm(fsRoot, { recursive: true, force: true }).catch(() => {});
  });

  const authHeaders = (token: string, mutation = false) => ({
    authorization: `Bearer ${token}`,
    origin: ORIGIN,
    ...(mutation ? { 'x-csrf-token': '1' } : {}),
  });

  it('接收方 POST /shares/:id/copy 入队成功返回 state=copying', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/shares/${shareId}/copy`,
      headers: authHeaders(recipientToken, true),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().state).toBe('copying');
  });

  it('他人（非接收方）copy 返回 404 中文', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/shares/${shareId}/copy`,
      headers: authHeaders(otherToken, true),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ code: 'SHARE_NOT_FOUND', error: '分享不存在或不可复制' });
  });

  it('copyShareToLibrary 成功后：目标书 + 目标快照 + 复用 objectId 的 SnapshotObject', async () => {
    // 直接驱动复制核心逻辑（worker 路径已由单测覆盖）
    const result = await copyShareToLibrary({ shareId, recipientId });
    expect(result.targetBookId).toBeDefined();
    const targetBookId = result.targetBookId!;

    // share 状态变为 copied
    const share = await prisma.bookShare.findUnique({ where: { id: shareId } });
    expect(share?.status).toBe('copied');

    // 目标书独立：归属接收方，带 sourceBookId/sourceShareId
    const targetBook = await prisma.book.findUnique({ where: { id: targetBookId } });
    expect(targetBook?.userId).toBe(recipientId);
    expect(targetBook?.sourceBookId).toBe(bookId);
    expect(targetBook?.sourceShareId).toBe(shareId);
    expect(targetBook?.title).toBe('E1分享书');

    // 目标快照：ready + 复用原 manifest/archive 对象
    const targetSnapshot = await prisma.assetSnapshot.findFirst({ where: { bookId: targetBookId, ownerId: recipientId } });
    expect(targetSnapshot?.status).toBe('ready');
    expect(targetSnapshot?.manifestObjectId).toBe(manifestObjectId);
    expect(targetSnapshot?.archiveObjectId).toBe(archiveObjectId);
    expect(targetSnapshot?.version).toBe(1);

    // 目标书 currentSnapshotId 指向目标快照
    expect(targetBook?.currentSnapshotId).toBe(targetSnapshot?.id);

    // SnapshotObject 行被复制，objectId 与源一致（底层对象复用，不复制字节）
    const sourceObjs = await prisma.snapshotObject.findMany({ where: { snapshotId } });
    const targetObjs = await prisma.snapshotObject.findMany({ where: { snapshotId: targetSnapshot!.id } });
    expect(targetObjs.length).toBe(sourceObjs.length);
    const sourceIds = sourceObjs.map((o) => o.objectId).sort();
    const targetIds = targetObjs.map((o) => o.objectId).sort();
    expect(targetIds).toEqual(sourceIds);
  });

  it('再次 POST /shares/:id/copy 幂等返回 state=copied + targetBookId', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/shares/${shareId}/copy`,
      headers: authHeaders(recipientToken, true),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().state).toBe('copied');
    expect(res.json().targetBookId).toBeDefined();
  });

  it('源分享被撤销后 copy 返回 404', async () => {
    // 新建一个独立分享用于撤销测试
    const revokedShare = await prisma.bookShare.create({
      data: { bookId, snapshotId, senderId, recipientId, status: 'revoked', revokedAt: new Date() },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/shares/${revokedShare.id}/copy`,
      headers: authHeaders(recipientToken, true),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toContain('分享不存在或不可复制');
    await prisma.bookShare.deleteMany({ where: { id: revokedShare.id } }).catch(() => {});
  });
});
