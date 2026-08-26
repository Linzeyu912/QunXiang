import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../app.js';
import { prisma } from '@qunxiang/storage';
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

describe.runIf(dbAvailable)('角色合并 LLM 智能裁决', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let userId: string;
  let token: string;
  let bookId: string;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'merge-judge-integration-test-secret';
    process.env.LLM_PROVIDER = 'mock';
    process.env.NODE_ENV = 'test';
    process.env.ALLOWED_ORIGINS = ORIGIN;
    process.env.OBJECT_STORAGE_SIGN_SECRET = 'merge-judge-sign-secret-pa';
    app = await buildApp({ logger: false });
    // buildApp 内 loadPersistedConfig 可能从磁盘加载真实模型配置，
    // 强制切回 mock：chatExtract 返回结构不匹配 → 裁决确定性降级为全部转人工
    setRuntimeProvider('mock');

    const suffix = randomUUID();
    const user = await prisma.user.create({ data: testUserInput(`merge-judge-${suffix}@test.local`) });
    userId = user.id;
    token = app.jwt.sign({ userId: user.id, email: user.email, name: user.name });
    bookId = (await prisma.book.create({
      data: { title: '裁决测试', filePath: `D:/tmp/${suffix}.txt`, fileSize: 1, mimeType: 'text/plain', userId },
    })).id;

    // 构造一对「称谓归一化」疑似重复候选：萧炎 / 萧炎哥
    await prisma.character.create({
      data: {
        bookId, name: '萧炎', aliases: ['炎儿'], description: '萧家少年', confidence: 0.9,
        chapterAppearances: [1], mentionCount: 3, dialogueCount: 1,
      },
    });
    await prisma.character.create({
      data: {
        bookId, name: '萧炎哥', description: '被这样称呼的角色', confidence: 0.8,
        chapterAppearances: [12], mentionCount: 2, dialogueCount: 1,
      },
    });
  });

  afterAll(async () => {
    if (userId) {
      await prisma.book.deleteMany({ where: { userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    }
    if (app) await app.close();
  });

  async function authPost(path: string, body?: unknown) {
    const res = await app.inject({
      method: 'POST',
      url: path,
      headers: {
        authorization: `Bearer ${token}`,
        origin: ORIGIN,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      payload: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.statusCode, body: res.json() as Record<string, unknown> };
  }

  it('1. 缺少 bookId 返回 400', async () => {
    const { status } = await authPost('/characters/merge-candidates/llm-judge', {});
    expect(status).toBe(400);
  });

  it('2. mock 模型返回结构不匹配时全部候选降级转人工，不自动合并', async () => {
    const { status, body } = await authPost('/characters/merge-candidates/llm-judge', { bookId });
    expect(status).toBe(200);
    expect(body.merged).toEqual([]);
    expect(body.separated).toEqual([]);
    expect((body.pending as unknown[]).length).toBe(1);
    expect((body.pending as Array<{ primary: string; secondary: string }>)[0]).toMatchObject({
      primary: '萧炎',
      secondary: '萧炎哥',
    });

    // 裁决后候选列表不变（未被自动处理）
    const candidates = await app.inject({
      method: 'GET',
      url: `/characters/merge-candidates?bookId=${bookId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(candidates.statusCode).toBe(200);
    expect(candidates.json().candidates).toHaveLength(1);
  });

  it('3. 无候选的书返回提示信息', async () => {
    const emptyBook = await prisma.book.create({
      data: { title: '空书', filePath: `D:/tmp/${randomUUID()}.txt`, fileSize: 1, mimeType: 'text/plain', userId },
    });
    const { status, body } = await authPost('/characters/merge-candidates/llm-judge', { bookId: emptyBook.id });
    expect(status).toBe(200);
    expect(body.merged).toEqual([]);
    expect(body.pending).toEqual([]);
    expect(typeof body.message).toBe('string');
  });
});
