import { createHash, randomBytes } from 'node:crypto';

export const createRefreshToken = () => randomBytes(32).toString('base64url');

export const refreshTokenHash = (token: string) =>
  createHash('sha256').update(token, 'utf8').digest('hex');
