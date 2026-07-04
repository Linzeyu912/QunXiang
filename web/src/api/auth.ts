import { useMutation } from '@tanstack/react-query';
import { apiFetch } from './client';
import { useAuthStore, type AuthUser } from '@/store/authStore';

/** 默认本地账号（与后端 api/src/lib/defaultUser.ts 的 DEFAULT_USER 对应）。 */
export const DEFAULT_CREDENTIALS = {
  email: 'test@example.com',
  password: 'example',
} as const;

export function useLogin() {
  const setAuth = useAuthStore((s) => s.setAuth);
  return useMutation({
    mutationFn: (body: { email: string; password: string }) =>
      apiFetch<{ token: string; user: AuthUser }>('/auth/login', { method: 'POST', body }),
    onSuccess: (data) => setAuth(data.token, data.user),
  });
}

export function useRegister() {
  const setAuth = useAuthStore((s) => s.setAuth);
  return useMutation({
    mutationFn: (body: { email: string; password: string; name: string }) =>
      apiFetch<{ token: string; user: AuthUser }>('/auth/register', { method: 'POST', body }),
    onSuccess: (data) => setAuth(data.token, data.user),
  });
}

/** 用当前 token 取回用户对象，用于刷新后恢复登录态。 */
export function useBootstrapUser() {
  const setUser = useAuthStore((s) => s.setUser);
  const logout = useAuthStore((s) => s.logout);
  return useMutation({
    mutationFn: () => apiFetch<{ user: AuthUser }>('/auth/me'),
    onSuccess: (data) => setUser(data.user),
    onError: () => logout(),
  });
}

/**
 * 无 token 时用默认账号静默登录，供 App 启动 effect 直接 await。
 * 不挂在 hook 上，避免和组件重渲染耦合。失败时抛出，由调用方决定落点（登录页兜底）。
 */
export async function loginDefaultUser(): Promise<{ token: string; user: AuthUser }> {
  return apiFetch<{ token: string; user: AuthUser }>('/auth/login', {
    method: 'POST',
    body: DEFAULT_CREDENTIALS,
  });
}
