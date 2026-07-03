import { create } from 'zustand';

const TOKEN_KEY = 'na-token';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  /** /auth/me 加载态：有 token 时启动校验，期间用于避免误跳登录页。 */
  bootstrapping: boolean;
  setAuth: (token: string, user: AuthUser) => void;
  setUser: (user: AuthUser) => void;
  setBootstrapping: (v: boolean) => void;
  logout: () => void;
}

function loadToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export const useAuthStore = create<AuthState>((set) => ({
  token: loadToken(),
  user: null,
  bootstrapping: !!loadToken(),
  setAuth: (token, user) => {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* 忽略隐私模式写入失败 */
    }
    set({ token, user, bootstrapping: false });
  },
  setUser: (user) => set({ user, bootstrapping: false }),
  setBootstrapping: (v) => set({ bootstrapping: v }),
  logout: () => {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
    set({ token: null, user: null, bootstrapping: false });
  },
}));

/** 非组件场景（apiFetch、SSE）读取当前 token。 */
export function getToken(): string | null {
  return useAuthStore.getState().token;
}
