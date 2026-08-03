import type { PrismaClient, RefreshSession } from '@prisma/client';
import { prisma } from './prisma.js';

export interface CreateRefreshSessionData {
  userId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
}

export interface RotateRefreshSessionData {
  sessionId: string;
  tokenHash: string;
  nextTokenHash: string;
  nextExpiresAt: Date;
  now: Date;
}

export interface RefreshSessionRepository {
  createSession(data: CreateRefreshSessionData): Promise<RefreshSession>;
  findByTokenHash(tokenHash: string): Promise<RefreshSession | null>;
  rotateSession(data: RotateRefreshSessionData): Promise<RefreshSession>;
  revokeCurrent(sessionId: string, now?: Date): Promise<boolean>;
  revokeFamily(familyId: string, now?: Date): Promise<number>;
  revokeAllForUser(userId: string, now?: Date): Promise<number>;
  countActiveFamily(familyId: string, now?: Date): Promise<number>;
}

export function createRefreshSessionRepository(db: PrismaClient): RefreshSessionRepository {
  return {
    async createSession(data) {
      return db.refreshSession.create({ data });
    },

    async findByTokenHash(tokenHash) {
      return db.refreshSession.findUnique({ where: { tokenHash } });
    },

    async rotateSession(data) {
      const result = await db.$transaction(async (tx) => {
        const consumed = await tx.refreshSession.updateMany({
          where: {
            id: data.sessionId,
            tokenHash: data.tokenHash,
            rotatedAt: null,
            revokedAt: null,
            expiresAt: { gt: data.now },
          },
          data: { rotatedAt: data.now },
        });

        if (consumed.count === 1) {
          const current = await tx.refreshSession.findUniqueOrThrow({
            where: { id: data.sessionId },
            select: { userId: true, familyId: true },
          });
          const session = await tx.refreshSession.create({
            data: {
              userId: current.userId,
              familyId: current.familyId,
              tokenHash: data.nextTokenHash,
              expiresAt: data.nextExpiresAt,
            },
          });
          return { kind: 'rotated' as const, session };
        }

        const current = await tx.refreshSession.findUnique({ where: { id: data.sessionId } });
        if (!current || current.tokenHash !== data.tokenHash) {
          return { kind: 'invalid' as const };
        }
        if (current.expiresAt <= data.now) {
          return { kind: 'expired' as const };
        }
        if (current.rotatedAt) {
          await tx.refreshSession.updateMany({
            where: { familyId: current.familyId, revokedAt: null },
            data: { revokedAt: data.now },
          });
          return { kind: 'replayed' as const };
        }
        return { kind: 'revoked' as const };
      });

      if (result.kind === 'rotated') return result.session;
      if (result.kind === 'replayed') throw new Error('刷新令牌已被使用');
      if (result.kind === 'expired') throw new Error('刷新会话已过期');
      if (result.kind === 'revoked') throw new Error('刷新会话已失效');
      throw new Error('刷新令牌无效');
    },

    async revokeCurrent(sessionId, now = new Date()) {
      const result = await db.refreshSession.updateMany({
        where: { id: sessionId, revokedAt: null },
        data: { revokedAt: now },
      });
      return result.count === 1;
    },

    async revokeFamily(familyId, now = new Date()) {
      const result = await db.refreshSession.updateMany({
        where: { familyId, revokedAt: null },
        data: { revokedAt: now },
      });
      return result.count;
    },

    async revokeAllForUser(userId, now = new Date()) {
      const result = await db.refreshSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
      });
      return result.count;
    },

    async countActiveFamily(familyId, now = new Date()) {
      return db.refreshSession.count({
        where: {
          familyId,
          rotatedAt: null,
          revokedAt: null,
          expiresAt: { gt: now },
        },
      });
    },
  };
}

export const RefreshSessionRepository = createRefreshSessionRepository(prisma);
