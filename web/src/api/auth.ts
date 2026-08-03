import { useMutation } from '@tanstack/react-query';
import { apiFetch } from './client';
import { refreshAccessToken } from './client';
import { useAuthStore, type AuthUser } from '../store/authStore';

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
      apiFetch<{ token: string; user: AuthUser; shareCode: string }>('/auth/register', { method: 'POST', body }),
    onSuccess: (data) => setAuth(data.token, data.user),
  });
}

/** 应用启动时只使用刷新 Cookie 恢复会话，不进行默认账号登录。 */
export async function bootstrapSession(): Promise<void> {
  useAuthStore.getState().setBootstrapping(true);
  try {
    await refreshAccessToken();
  } finally {
    useAuthStore.getState().setBootstrapping(false);
  }
}

/** 先撤销服务端会话，再清理内存登录态。 */
export async function logoutSession(): Promise<void> {
  try {
    await apiFetch('/auth/session/logout', { method: 'POST' });
  } finally {
    await useAuthStore.getState().logout();
  }
}
