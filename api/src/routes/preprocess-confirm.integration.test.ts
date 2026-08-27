import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../app.js';
import { prisma } from '@qunxiang/storage';
import { testUserInput } from '../../../storage/src/test-fixtures.js';

const ORIGIN = 'http://localhost:5173';

// 模块级 DB 可用性探测
let dbAvailable = false;
await Promise.race([
  prisma.$queryRaw`SELECT 1`.then(() => { dbAvailable = true; }, () => { dbAvailable = false; }),
  new Promise((resolve) => setTimeout(resolve, 3000)),
]);

describe.runIf(dbAvailable)('原文版本确认（实施包 C1/C4）', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let userId: string;
  let token: string;
  let bookId: string;

  const headers = () => ({
    authorization: `Bearer ${token}`,
    origin: ORIGIN,
    'content-type': 'application/json',
  });

  beforeAll(async () => {
    process.env.JWT_SECRET = 'preprocess-confirm-test-secret';
    process.env.LLM_PROVIDER = 'mock';
    process.env.NODE_ENV = 'test';
    process.env.ALLOWED_ORIGINS = ORIGIN;
    process.env.OBJECT_STORAGE_SIGN_SECRET = 'preprocess-sign-secret';
    app = await buildApp({ logger: false });

    const suffix = randomUUID();
    const user = await prisma.user.create({ data: testUserInput(`preprocess-${suffix}@test.local`) });
    userId = user.id;
    token = app.jwt.sign({ userId: user.id, email: user.email, name: user.name });
    bookId = (await prisma.book.create({
      data: {
        title: '版本确认测试', filePath: `D:/tmp/${suffix}.txt`, fileSize: 1,
        mimeType: 'text/plain', userId, sourceRevision: 0, preprocessConfirmedRevision: 0,
      },
    })).id;
  });

  afterAll(async () => {
    if (userId) {
      await prisma.book.deleteMany({ where: { userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    }
    if (app) await app.close();
  });

  it('1. 噪声覆盖变化后版本 +1 且需重新确认，未确认启动提取返回 409', async () => {
    const restore = await app.inject({
      method: 'POST',
      url: `/books/${bookId}/chapters/noise/restore`,
      headers: headers(),
      payload: JSON.stringify({ lineNum: 3 }),
    });
    expect(restore.statusCode, restore.body).toBe(200);
    expect(restore.json().needsReconfirm).toBe(true);

    const book = await prisma.book.findUnique({ where: { id: bookId } });
    expect(book?.sourceRevision).toBe(1);
    expect(book?.preprocessConfirmedRevision).toBeNull();

    const start = await app.inject({
      method: 'POST',
      url: `/books/${bookId}/extract`,
      headers: headers(),
      payload: JSON.stringify({}),
    });
    expect(start.statusCode).toBe(409);
    expect(start.json().error).toContain('确认当前版本');
  });

  it('2. 确认接口恢复可提取状态（幂等）', async () => {
    const confirm = await app.inject({
      method: 'POST',
      url: `/books/${bookId}/preprocess/confirm`,
      headers: headers(),
      payload: JSON.stringify({}),
    });
    expect(confirm.statusCode, confirm.body).toBe(200);
    expect(confirm.json().alreadyConfirmed).toBe(false);
    const book = await prisma.book.findUnique({ where: { id: bookId } });
    expect(book?.preprocessConfirmedRevision).toBe(book?.sourceRevision);

    const again = await app.inject({
      method: 'POST',
      url: `/books/${bookId}/preprocess/confirm`,
      headers: headers(),
      payload: JSON.stringify({}),
    });
    expect(again.statusCode).toBe(200);
    expect(again.json().alreadyConfirmed).toBe(true);
  });
});
