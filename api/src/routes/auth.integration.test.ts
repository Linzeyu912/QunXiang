import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { closeDatabase, prisma, UserRepository } from '@qunxiang/storage';
import { hashPassword } from '../lib/password.js';
import { createShareCode, verifyShareCode } from '../lib/share-code.js';

const PASSWORD = '安全密码123';
const TRUSTED_ORIGIN = 'http://localhost:5173';

describe('账号注册、登录和分享码', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'integration-test-jwt-secret';
    process.env.LLM_PROVIDER = 'mock';
    process.env.NODE_ENV = 'test';
    process.env.ALLOWED_ORIGINS = TRUSTED_ORIGIN;
    app = await buildApp({ logger: false });
  });

  beforeEach(async () => {
    const testUsers = await prisma.user.findMany({
      where: { emailNormalized: { endsWith: '@auth.integration.test' } },
      select: { id: true },
    });
    await prisma.refreshSession.deleteMany({
      where: { userId: { in: testUsers.map(({ id }) => id) } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: testUsers.map(({ id }) => id) } },
    });
  });

  afterAll(async () => {
    await app?.close();
    await closeDatabase();
  });

  async function register(email = ' User@Auth.Integration.Test ') {
    return app.inject({
      method: 'POST',
      url: '/auth/register',
      headers: { origin: TRUSTED_ORIGIN },
      payload: { email, password: PASSWORD, name: '测试用户' },
    });
  }

  it('注册持久化账号并返回访问令牌和一次性分享码', async () => {
    const response = await register();
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const body = response.json();
    expect(body.token).toEqual(expect.any(String));
    expect(body.shareCode).toEqual(expect.any(String));
    expect(body.user).toEqual(expect.objectContaining({ email: 'user@auth.integration.test' }));
    expect(JSON.stringify(body)).not.toContain('passwordHash');
    expect(JSON.stringify(body)).not.toContain('shareCodeHash');

    const stored = await prisma.user.findUnique({ where: { emailNormalized: 'user@auth.integration.test' } });
    expect(stored?.email).toBe('user@auth.integration.test');
    expect(stored?.shareCodeHash).not.toBe(body.shareCode);
  });

  it('不同大小写的重复邮箱返回相同中文冲突', async () => {
    expect((await register('User@Auth.Integration.Test')).statusCode).toBe(200);
    const duplicate = await register(' user@AUTH.integration.test ');
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toEqual({ error: '该邮箱已注册' });
  });

  it('登录使用规范化邮箱且不返回密码或摘要', async () => {
    await register('user@auth.integration.test');
    const response = await app.inject({
      method: 'POST', url: '/auth/login',
      headers: { origin: TRUSTED_ORIGIN },
      payload: { email: ' USER@AUTH.INTEGRATION.TEST ', password: PASSWORD },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const serialized = JSON.stringify(response.json());
    expect(serialized).not.toContain('passwordHash');
    expect(serialized).not.toContain('shareCodeHash');
    expect(response.json().user.email).toBe('user@auth.integration.test');
  });

  it('未知邮箱和错误密码返回相同中文错误', async () => {
    await register('known@auth.integration.test');
    const unknown = await app.inject({
      method: 'POST', url: '/auth/login',
      headers: { origin: TRUSTED_ORIGIN },
      payload: { email: 'unknown@auth.integration.test', password: PASSWORD },
    });
    const wrong = await app.inject({
      method: 'POST', url: '/auth/login',
      headers: { origin: TRUSTED_ORIGIN },
      payload: { email: 'known@auth.integration.test', password: '错误密码123' },
    });
    expect(unknown.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    expect(unknown.json()).toEqual({ error: '邮箱或密码错误' });
    expect(wrong.json()).toEqual(unknown.json());
  });

  it('轮换分享码后旧码立即失效', async () => {
    const original = createShareCode();
    await UserRepository.create({
      email: 'rotate@auth.integration.test',
      emailNormalized: 'rotate@auth.integration.test',
      name: '轮换测试用户',
      passwordHash: await hashPassword(PASSWORD),
      shareCodeHash: original.hash,
    });
    const login = await app.inject({
      method: 'POST', url: '/auth/login',
      headers: { origin: TRUSTED_ORIGIN },
      payload: { email: 'rotate@auth.integration.test', password: PASSWORD },
    });
    const token = login.json().token;
    const response = await app.inject({
      method: 'POST', url: '/account/share-code/rotate',
      headers: { authorization: `Bearer ${token}`, origin: TRUSTED_ORIGIN, 'x-csrf-token': '1' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const rotated = response.json();
    expect(rotated.shareCode).not.toBe(original.plain);

    const stored = await prisma.user.findUniqueOrThrow({ where: { emailNormalized: 'rotate@auth.integration.test' } });
    expect(verifyShareCode(original.plain, stored.shareCodeHash)).toBe(false);
    expect(verifyShareCode(rotated.shareCode, stored.shareCodeHash)).toBe(true);
  });

  it('停用账号不能登录并收到中文状态错误', async () => {
    const shareCode = createShareCode();
    await UserRepository.create({
      email: 'disabled@auth.integration.test',
      emailNormalized: 'disabled@auth.integration.test',
      name: '停用测试用户',
      passwordHash: await hashPassword(PASSWORD),
      shareCodeHash: shareCode.hash,
      status: 'DISABLED',
    });
    const response = await app.inject({
      method: 'POST', url: '/auth/login',
      headers: { origin: TRUSTED_ORIGIN },
      payload: { email: 'disabled@auth.integration.test', password: PASSWORD },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: '账号已停用，请联系管理员' });
  });

  it('账号在登录后被停用，既有令牌无法继续访问或刷新', async () => {
    const shareCode = createShareCode();
    const user = await UserRepository.create({
      email: 'revoked@auth.integration.test',
      emailNormalized: 'revoked@auth.integration.test',
      name: '停用令牌测试用户',
      passwordHash: await hashPassword(PASSWORD),
      shareCodeHash: shareCode.hash,
    });
    const login = await app.inject({
      method: 'POST', url: '/auth/login',
      headers: { origin: TRUSTED_ORIGIN },
      payload: { email: user.email, password: PASSWORD },
    });
    const authorization = `Bearer ${login.json().token}`;
    const setCookie = login.headers['set-cookie'];
    const refreshCookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)?.split(';', 1)[0];
    if (!refreshCookie) throw new Error('登录响应未设置刷新 Cookie');
    await prisma.user.update({ where: { id: user.id }, data: { status: 'DISABLED' } });

    const responses = await Promise.all([
      app.inject({ method: 'GET', url: '/auth/me', headers: { authorization } }),
      app.inject({ method: 'POST', url: '/account/share-code/rotate', headers: { authorization, origin: TRUSTED_ORIGIN, 'x-csrf-token': '1' } }),
      app.inject({
        method: 'POST',
        url: '/auth/session/refresh',
        headers: { cookie: refreshCookie, origin: TRUSTED_ORIGIN, 'x-csrf-token': '1' },
      }),
    ]);
    for (const response of responses) {
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: '账号已停用，请联系管理员' });
    }
  });
});
