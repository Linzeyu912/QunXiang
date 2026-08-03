import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, refreshAccessToken } from './client';
import { useAuthStore } from '../store/authStore';

const user = { id: 'user-1', email: 'reader@example.com', name: '读者' };

beforeEach(() => {
  useAuthStore.setState({ token: 'expired-token', user, bootstrapping: false });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useAuthStore.setState({ token: null, user: null, bootstrapping: true });
});

describe('统一请求认证', () => {
  it('concurrent_401_requests_share_one_refresh_and_retry_once', async () => {
    let protectedCalls = 0;
    let refreshCalls = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const path = String(input);
      if (path === '/auth/session/refresh') {
        refreshCalls += 1;
        return Response.json({ token: 'fresh-token', user });
      }
      protectedCalls += 1;
      if (protectedCalls <= 2) {
        return Response.json({ error: '登录已过期' }, { status: 401 });
      }
      return Response.json({ ok: true });
    });
    vi.stubGlobal('fetch', fetchMock);

    const results = await Promise.all([
      apiFetch<{ ok: boolean }>('/books/one'),
      apiFetch<{ ok: boolean }>('/books/two'),
    ]);

    expect(results).toEqual([{ ok: true }, { ok: true }]);
    expect(refreshCalls).toBe(1);
    expect(protectedCalls).toBe(4);
    expect(useAuthStore.getState().token).toBe('fresh-token');
  });

  it('failed_refresh_clears_auth_state_without_retry_loop', async () => {
    let protectedCalls = 0;
    let refreshCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      if (String(input) === '/auth/session/refresh') {
        refreshCalls += 1;
        return Response.json({ error: '刷新会话无效，请重新登录' }, { status: 401 });
      }
      protectedCalls += 1;
      return Response.json({ error: '登录已过期' }, { status: 401 });
    }));

    await expect(apiFetch('/books/one')).rejects.toMatchObject({ status: 401 });

    expect(refreshCalls).toBe(1);
    expect(protectedCalls).toBe(1);
    expect(useAuthStore.getState()).toMatchObject({ token: null, user: null });
  });

  it('刷新成功但重试仍为401时清空登录态且不再刷新', async () => {
    let protectedCalls = 0;
    let refreshCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      if (String(input) === '/auth/session/refresh') {
        refreshCalls += 1;
        return Response.json({ token: 'fresh-token', user });
      }
      protectedCalls += 1;
      return Response.json({ error: '登录状态已失效，请重新登录' }, { status: 401 });
    }));

    await expect(apiFetch('/books/one')).rejects.toMatchObject({ status: 401 });

    expect(refreshCalls).toBe(1);
    expect(protectedCalls).toBe(2);
    expect(useAuthStore.getState()).toMatchObject({ token: null, user: null });
  });

  it('mutation_requests_send_csrf_header_and_credentials', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await apiFetch('/books/one', { method: 'PATCH', body: { name: '新书名' } });

    const init = fetchMock.mock.calls[0]?.[1];
    if (!init) throw new Error('请求参数缺失');
    expect(init.credentials).toBe('include');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer expired-token',
      'Content-Type': 'application/json',
      'X-CSRF-Token': '1',
    });
  });

  it('访问令牌过期时退出会先刷新再重试服务端撤销', async () => {
    let logoutCalls = 0;
    let refreshCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      if (String(input) === '/auth/session/refresh') {
        refreshCalls += 1;
        return Response.json({ token: 'fresh-token', user });
      }
      if (String(input) === '/auth/session/logout') {
        logoutCalls += 1;
        return logoutCalls === 1
          ? Response.json({ error: '登录已过期' }, { status: 401 })
          : new Response(null, { status: 204 });
      }
      throw new Error('意外请求');
    }));

    await expect(apiFetch('/auth/session/logout', { method: 'POST' })).resolves.toBeUndefined();
    expect(refreshCalls).toBe(1);
    expect(logoutCalls).toBe(2);
  });

  it('进行中的旧刷新不会覆盖随后完成的新登录', async () => {
    let resolveRefresh!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => {
      resolveRefresh = resolve;
    })));

    const pending = refreshAccessToken();
    await useAuthStore.getState().setAuth('new-login-token', {
      id: 'user-2', email: 'new@example.com', name: '新账号',
    });
    resolveRefresh(Response.json({ token: 'old-refresh-token', user }));

    await expect(pending).resolves.toBeNull();
    expect(useAuthStore.getState().token).toBe('new-login-token');
    expect(useAuthStore.getState().user?.id).toBe('user-2');
  });

  it('账号切换后不把旧账号请求重放到新账号', async () => {
    let resolveProtected!: (response: Response) => void;
    let protectedCalls = 0;
    let refreshCalls = 0;
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
      if (String(input) === '/auth/session/refresh') {
        refreshCalls += 1;
        return Promise.resolve(Response.json({ token: 'unexpected', user }));
      }
      protectedCalls += 1;
      if (protectedCalls > 1) return Promise.resolve(Response.json({ ok: true }));
      return new Promise<Response>((resolve) => {
        resolveProtected = resolve;
      });
    }));

    const pending = apiFetch('/books/old-owner', { method: 'PATCH', body: { title: '旧请求' } });
    await useAuthStore.getState().setAuth('account-b-token', {
      id: 'user-b', email: 'b@example.com', name: '账号乙',
    });
    resolveProtected(Response.json({ error: '登录已过期' }, { status: 401 }));

    await expect(pending).rejects.toMatchObject({ status: 401 });
    expect(protectedCalls).toBe(1);
    expect(refreshCalls).toBe(0);
    expect(useAuthStore.getState().token).toBe('account-b-token');
  });
});
