import { create } from 'zustand';
import { transitionAccountQueryOwner } from '../lib/account-query-cache';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  /** 启动刷新会话期间用于避免误跳登录页。 */
  bootstrapping: boolean;
  setAuth: (token: string, user: AuthUser) => Promise<void>;
  setUser: (user: AuthUser) => void;
  setBootstrapping: (v: boolean) => void;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  user: null,
  // 启动时只通过 HttpOnly Cookie 刷新会话，不从浏览器持久存储恢复令牌。
  bootstrapping: true,
  setAuth: async (token, user) => {
    await transitionAccountQueryOwner(user.id);
    set({ token, user, bootstrapping: false });
  },
  setUser: (user) => set({ user, bootstrapping: false }),
  setBootstrapping: (v) => set({ bootstrapping: v }),
  logout: async () => {
    await transitionAccountQueryOwner(null);
    set({ token: null, user: null, bootstrapping: false });
  },
}));

/** 非组件场景（apiFetch、SSE）读取当前 token。 */
export function getToken(): string | null {
  return useAuthStore.getState().token;
}
