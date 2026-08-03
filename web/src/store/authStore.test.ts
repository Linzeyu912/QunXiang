import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

const user = { id: 'user-1', email: 'reader@example.com', name: '读者' };

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('前端内存登录态', () => {
  it('auth_store_never_reads_or_writes_local_storage', async () => {
    const getItem = vi.fn(() => null);
    const setItem = vi.fn();
    const removeItem = vi.fn();
    vi.stubGlobal('localStorage', { getItem, setItem, removeItem });

    const { useAuthStore } = await import('./authStore');
    await useAuthStore.getState().setAuth('access-token', user);
    await useAuthStore.getState().logout();

    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
  });

  it('startup_refresh_restores_user_without_default_login', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toBe('/auth/session/refresh');
      return new Response(JSON.stringify({ token: 'restored-token', user }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { bootstrapSession } = await import('../api/auth');
    const { useAuthStore } = await import('./authStore');
    await bootstrapSession();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState()).toMatchObject({
      token: 'restored-token',
      user,
      bootstrapping: false,
    });
  });

  it('换号前取消在途查询并清空旧账号缓存', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { registerAccountQueryClient } = await import('../lib/account-query-cache');
    const { useAuthStore } = await import('./authStore');
    registerAccountQueryClient(queryClient);

    await useAuthStore.getState().setAuth('account-a-token', user);
    queryClient.setQueryData(['books'], [{ id: 'account-a-book' }]);

    let resolveOldQuery!: (value: string) => void;
    const oldPendingQuery = queryClient.fetchQuery({
      queryKey: ['books', 'account-a-book', 'content'],
      queryFn: () => new Promise<string>((resolve) => { resolveOldQuery = resolve; }),
    });

    await useAuthStore.getState().logout();
    await useAuthStore.getState().setAuth('account-b-token', {
      id: 'user-2', email: 'reader-b@example.com', name: '读者乙',
    });
    resolveOldQuery('账号甲的正文');
    await oldPendingQuery.catch(() => undefined);
    await Promise.resolve();

    expect(queryClient.getQueryData(['books'])).toBeUndefined();
    expect(queryClient.getQueryData(['books', 'account-a-book', 'content'])).toBeUndefined();
  });
});
