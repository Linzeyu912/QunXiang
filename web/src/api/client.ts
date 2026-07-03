import { getToken, useAuthStore } from '@/store/authStore';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

interface ApiFetchOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  raw?: boolean;
}

/**
 * 统一请求入口：
 * - 自动附带 Authorization: Bearer <token>
 * - 401（非 /auth 请求）视为登录态失效，清空并跳转登录
 */
export async function apiFetch<T = unknown>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { body, raw, headers, ...rest } = options;

  const finalHeaders: Record<string, string> = {
    ...(headers as Record<string, string> | undefined),
  };

  const token = getToken();
  if (token) {
    finalHeaders['Authorization'] = `Bearer ${token}`;
  }

  let finalBody: BodyInit | undefined;
  if (body instanceof FormData) {
    finalBody = body;
  } else if (body !== undefined) {
    finalHeaders['Content-Type'] = 'application/json';
    finalBody = JSON.stringify(body);
  }

  const res = await fetch(path, {
    ...rest,
    headers: finalHeaders,
    body: finalBody,
  });

  // 登录态失效：清空 token 并跳登录。/auth/* 自己处理 401（如密码错误），不跳转。
  if (res.status === 401 && !path.startsWith('/auth')) {
    useAuthStore.getState().logout();
    if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
      window.location.assign('/login');
    }
  }

  if (!res.ok) {
    let message = `Request failed: ${res.status}`;
    try {
      const errBody = await res.json();
      if (errBody && typeof errBody === 'object' && 'error' in errBody) {
        message = String((errBody as { error: unknown }).error);
      }
    } catch {
      // ignore parse failure
    }
    throw new ApiError(message, res.status);
  }

  if (raw) return res as unknown as T;
  if (res.status === 204) return undefined as T;

  const text = await res.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}
