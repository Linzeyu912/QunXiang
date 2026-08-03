import { getToken, useAuthStore, type AuthUser } from '../store/authStore';

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

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const SESSION_REFRESH_PATH = '/auth/session/refresh';
const NO_AUTO_REFRESH_PATHS = new Set([
  '/auth/login',
  '/auth/register',
  SESSION_REFRESH_PATH,
]);
let refreshPromise: Promise<string | null> | null = null;
let refreshFromToken: string | null | undefined;
let lastRefresh: { from: string | null; to: string } | null = null;

async function readErrorMessage(res: Response): Promise<string> {
  let message = `请求失败：${res.status}`;
  try {
    const errBody = await res.json();
    if (errBody && typeof errBody === 'object' && 'error' in errBody) {
      message = String((errBody as { error: unknown }).error);
    }
  } catch {
    // 响应不是 JSON 时保留通用中文错误。
  }
  return message;
}

async function performRefresh(tokenAtStart: string | null): Promise<string | null> {
  try {
    const res = await fetch(SESSION_REFRESH_PATH, {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-CSRF-Token': '1' },
    });
    if (!res.ok) {
      const currentToken = getToken();
      if (currentToken === tokenAtStart) {
        await useAuthStore.getState().logout();
        return null;
      }
      return null;
    }
    const data = await res.json() as { token: string; user: AuthUser };
    const currentToken = getToken();
    if (currentToken !== tokenAtStart) return null;
    await useAuthStore.getState().setAuth(data.token, data.user);
    lastRefresh = { from: tokenAtStart, to: data.token };
    return data.token;
  } catch {
    const currentToken = getToken();
    if (currentToken === tokenAtStart) {
      await useAuthStore.getState().logout();
      return null;
    }
    return null;
  }
}

/** 使用刷新 Cookie 恢复访问令牌；并发调用共享同一个请求。 */
export function refreshAccessToken(expectedToken = getToken()): Promise<string | null> {
  const currentToken = getToken();
  if (currentToken !== expectedToken) {
    const cameFromExpectedRefresh = lastRefresh?.from === expectedToken
      && lastRefresh.to === currentToken;
    return Promise.resolve(cameFromExpectedRefresh ? currentToken : null);
  }
  if (refreshPromise) {
    return refreshFromToken === expectedToken ? refreshPromise : Promise.resolve(null);
  }
  refreshFromToken = expectedToken;
  refreshPromise = performRefresh(expectedToken).finally(() => {
    refreshPromise = null;
    refreshFromToken = undefined;
  });
  return refreshPromise;
}

export interface AuthenticatedSseEvent {
  event: string;
  data: string;
}

interface AuthenticatedSseOptions {
  signal: AbortSignal;
  onEvent: (event: AuthenticatedSseEvent) => void;
}

function emitSseBlock(block: string, onEvent: AuthenticatedSseOptions['onEvent']) {
  let event = 'message';
  const data: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith('event:')) event = line.slice(6).trimStart();
    if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
  }
  if (data.length > 0) onEvent({ event, data: data.join('\n') });
}

/** 通过可设置 Authorization 头的 fetch 读取 SSE，令牌不会进入 URL。 */
export async function openAuthenticatedSse(
  path: string,
  options: AuthenticatedSseOptions,
): Promise<void> {
  const res = await apiFetch<Response>(path, { raw: true, signal: options.signal });
  if (!res.body) throw new Error('服务器未返回进度流');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, '\n');
    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      emitSseBlock(buffer.slice(0, boundary), options.onEvent);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf('\n\n');
    }
    if (done) break;
  }
  if (buffer.trim()) emitSseBlock(buffer, options.onEvent);
}

/**
 * 统一请求入口：
 * - 自动附带 Authorization: Bearer <token>
 * - 401（非 /auth 请求）视为登录态失效，清空并跳转登录
 */
export async function apiFetch<T = unknown>(
  path: string,
  options: ApiFetchOptions = {},
  retried = false,
): Promise<T> {
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

  const method = (rest.method ?? 'GET').toUpperCase();
  if (MUTATION_METHODS.has(method)) {
    finalHeaders['X-CSRF-Token'] = '1';
  }

  const res = await fetch(path, {
    ...rest,
    credentials: 'include',
    headers: finalHeaders,
    body: finalBody,
  });

  // 受保护请求只允许刷新并重试一次；认证接口自行处理 401，避免递归刷新。
  const canAutoRefresh = !NO_AUTO_REFRESH_PATHS.has(path);
  if (res.status === 401 && !retried && canAutoRefresh) {
    const refreshedToken = await refreshAccessToken(token);
    if (refreshedToken) {
      return apiFetch<T>(path, options, true);
    }
  }

  if (res.status === 401 && retried && canAutoRefresh) {
    await useAuthStore.getState().logout();
  }

  if (!res.ok) {
    const message = await readErrorMessage(res);
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
