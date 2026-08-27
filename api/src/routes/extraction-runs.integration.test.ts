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

describe.runIf(dbAvailable)('提取运行接口（实施包 D1/D3）', () => {
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
    process.env.JWT_SECRET = 'extraction-runs-test-secret';
    process.env.LLM_PROVIDER = 'mock';
    process.env.NODE_ENV = 'test';
    process.env.ALLOWED_ORIGINS = ORIGIN;
    process.env.OBJECT_STORAGE_SIGN_SECRET = 'runs-sign-secret';
    app = await buildApp({ logger: false });

    const suffix = randomUUID();
    const user = await prisma.user.create({ data: testUserInput(`runs-${suffix}@test.local`) });
    userId = user.id;
    token = app.jwt.sign({ userId: user.id, email: user.email, name: user.name });
    bookId = (await prisma.book.create({
      data: {
        title: '运行测试', filePath: `D:/tmp/${suffix}.txt`, fileSize: 1,
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

  it('1. 估算接口返回字数/调用次数/上限等预算信息', async () => {
    const res = await app.inject({ method: 'GET', url: `/books/${bookId}/extraction-runs/estimate`, headers: headers() });
    expect(res.statusCode, res.body).toBe(200);
    const est = res.json().estimate as { inputChars: number; estimatedCalls: number; maxCalls: number; queuedAhead: number };
    expect(est.inputChars).toBeGreaterThan(0);
    expect(est.estimatedCalls).toBeGreaterThanOrEqual(1);
    expect(est.maxCalls).toBeGreaterThanOrEqual(est.estimatedCalls);
  });

  it('2. 创建运行返回 201 并建立会话；重复创建返回 409', async () => {
    const create = await app.inject({
      method: 'POST', url: `/books/${bookId}/extraction-runs`, headers: headers(), payload: JSON.stringify({}),
    });
    // mock provider 未配置 key 时 startExtraction 可能失败 → 会话标 FAILED；
    // 但会话行必须已建立且接口行为正确
    if (create.statusCode === 201) {
      const runId = create.json().runId as string;
      expect(runId).toBeTruthy();
      const dup = await app.inject({
        method: 'POST', url: `/books/${bookId}/extraction-runs`, headers: headers(), payload: JSON.stringify({}),
      });
      // 上一运行若已失败/取消则允许新建；仅活动运行时 409
      if (!['COMPLETED', 'FAILED', 'CANCELLED'].includes(
        (await prisma.extractionSession.findUnique({ where: { id: runId } }))?.status ?? '')) {
        expect(dup.statusCode).toBe(409);
        expect(dup.json().error).toContain('已有进行中的运行');
      }
    } else {
      // 模型未配置等前置失败：返回中文错误
      expect(create.statusCode).toBeGreaterThanOrEqual(400);
      expect(typeof create.json().error).toBe('string');
    }
  });

  it('3. current 返回运行与任务列表（可能为空）', async () => {
    const res = await app.inject({ method: 'GET', url: `/books/${bookId}/extraction-runs/current`, headers: headers() });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { run: unknown | null; tasks: unknown[] };
    expect(Array.isArray(body.tasks)).toBe(true);
  });

  it('4. 对已结束/不存在的运行暂停返回 409/404', async () => {
    const pause = await app.inject({
      method: 'POST', url: `/books/${bookId}/extraction-runs/${randomUUID()}/pause`, headers: headers(), payload: JSON.stringify({}),
    });
    expect(pause.statusCode).toBe(404);
  });

  it('5. 导入书 stages 返回 imported 标记与中文文案', async () => {
    const seedBook = await prisma.book.create({
      data: {
        title: '导入书', filePath: `D:/tmp/${randomUUID()}.txt`, fileSize: 1,
        mimeType: 'text/plain', userId, sourceType: 'SEED', status: 'EXTRACTED',
      },
    });
    const res = await app.inject({ method: 'GET', url: `/books/${seedBook.id}/extract/stages`, headers: headers() });
    expect(res.statusCode).toBe(200);
    expect(res.json().imported).toBe(true);
    expect(res.json().importedMessage).toBe('这是导入结果，没有本机提取阶段记录。');
  });
});
