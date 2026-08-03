import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, prisma } from '@novel-agent/storage';
import { buildApp } from '../app.js';

const TRUSTED_ORIGIN = 'http://localhost:5173';
const TEST_DOMAIN = '@session.integration.test';
const PASSWORD = '安全密码123';

describe('刷新会话与请求安全边界', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'session-integration-test-secret';
    process.env.LLM_PROVIDER = 'mock';
    process.env.NODE_ENV = 'test';
    process.env.ALLOWED_ORIGINS = TRUSTED_ORIGIN;
    app = await buildApp({ logger: false });
  });

  beforeEach(async () => {
    const users = await prisma.user.findMany({
      where: { emailNormalized: { endsWith: TEST_DOMAIN } },
      select: { id: true },
    });
    await prisma.refreshSession.deleteMany({
      where: { userId: { in: users.map(({ id }) => id) } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: users.map(({ id }) => id) } },
    });
  });

  afterAll(async () => {
    await app.close();
    await closeDatabase();
  });

  async function register(prefix: string) {
    return app.inject({
      method: 'POST',
      url: '/auth/register',
      headers: { origin: TRUSTED_ORIGIN },
      payload: {
        email: `${prefix}${TEST_DOMAIN}`,
        password: PASSWORD,
        name: '会话测试用户',
      },
    });
  }

  function refreshCookie(response: Awaited<ReturnType<typeof app.inject>>) {
    const header = response.headers['set-cookie'];
    const serialized = Array.isArray(header) ? header[0] : header;
    if (!serialized) throw new Error('响应未设置刷新 Cookie');
    return serialized.split(';', 1)[0];
  }

  it('refresh_without_bearer_but_with_valid_cookie_succeeds', async () => {
    const registration = await register('refresh-success');
    const response = await app.inject({
      method: 'POST',
      url: '/auth/session/refresh',
      headers: {
        cookie: refreshCookie(registration),
        origin: TRUSTED_ORIGIN,
        'x-csrf-token': '1',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      token: expect.any(String),
      user: expect.objectContaining({ email: `refresh-success${TEST_DOMAIN}` }),
    });
  });

  it('refresh_cookie_has_http_only_secure_same_site_lax_and_scoped_path', async () => {
    const response = await register('cookie-attributes');
    const cookie = response.headers['set-cookie'];
    const serialized = Array.isArray(cookie) ? cookie.join('; ') : cookie ?? '';

    expect(serialized).toContain('na_refresh=');
    expect(serialized).toMatch(/HttpOnly/i);
    expect(serialized).toMatch(/Secure/i);
    expect(serialized).toMatch(/SameSite=Lax/i);
    expect(serialized).toMatch(/Path=\/auth\/session/i);
    expect(serialized).toMatch(/Max-Age=2592000/i);
  });

  it('refresh_without_cookie_returns_chinese_unauthorized', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/session/refresh',
      headers: { origin: TRUSTED_ORIGIN, 'x-csrf-token': '1' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: '刷新会话无效，请重新登录' });
  });

  it('refresh_with_untrusted_origin_is_rejected', async () => {
    const registration = await register('bad-origin');
    const response = await app.inject({
      method: 'POST',
      url: '/auth/session/refresh',
      headers: {
        cookie: refreshCookie(registration),
        origin: 'https://evil.example',
        'x-csrf-token': '1',
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: '请求来源不受信任' });
  });

  it('refresh_without_csrf_header_is_rejected', async () => {
    const registration = await register('missing-csrf');
    const response = await app.inject({
      method: 'POST',
      url: '/auth/session/refresh',
      headers: { cookie: refreshCookie(registration), origin: TRUSTED_ORIGIN },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: '缺少安全校验信息' });
  });

  it('logout_revokes_current_session', async () => {
    const registration = await register('logout');
    const cookie = refreshCookie(registration);
    const logout = await app.inject({
      method: 'POST',
      url: '/auth/session/logout',
      headers: {
        authorization: `Bearer ${registration.json().token}`,
        cookie,
        origin: TRUSTED_ORIGIN,
        'x-csrf-token': '1',
      },
    });
    expect(logout.statusCode).toBe(204);

    const refresh = await app.inject({
      method: 'POST',
      url: '/auth/session/refresh',
      headers: { cookie, origin: TRUSTED_ORIGIN, 'x-csrf-token': '1' },
    });
    expect(refresh.statusCode).toBe(401);
    expect(refresh.json()).toEqual({ error: '刷新会话无效，请重新登录' });
  });

  it('cors_preflight_allows_x_csrf_token_and_credentials', async () => {
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/auth/session/refresh',
      headers: {
        origin: TRUSTED_ORIGIN,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type,x-csrf-token',
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe(TRUSTED_ORIGIN);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
    expect(response.headers['access-control-allow-headers']?.toLowerCase()).toContain('x-csrf-token');
  });

  it('non_auth_mutation_with_untrusted_origin_is_rejected', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/books',
      headers: { origin: 'https://evil.example' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: '请求来源不受信任' });
  });
});
