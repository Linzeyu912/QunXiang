import { useMutation } from '@tanstack/react-query';
import { apiFetch } from './client';
import { useAuthStore, type AuthUser } from '@/store/authStore';

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
