export const ACCESS_TOKEN_EXPIRES_IN = '15m';
export const REFRESH_COOKIE_NAME = 'na_refresh';
export const REFRESH_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
export const REFRESH_SESSION_TTL_MS = REFRESH_SESSION_MAX_AGE_SECONDS * 1000;

export const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax' as const,
  path: '/auth/session',
  maxAge: REFRESH_SESSION_MAX_AGE_SECONDS,
};

export function getAllowedOrigins(): Set<string> {
  const configured = process.env.ALLOWED_ORIGINS
    ?.split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return new Set(configured?.length ? configured : ['http://localhost:5173']);
}
