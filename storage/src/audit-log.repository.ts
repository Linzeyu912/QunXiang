import type { AuditLog, Prisma, PrismaClient } from '@prisma/client';
import { prisma } from './prisma.js';

export interface CreateAuditLogData {
  actorType: string;
  actorId?: string | null;
  action: string;
  targetType: string;
  targetId: string;
  metadata: Prisma.InputJsonValue;
}

export interface AuditLogRepository {
  create(data: CreateAuditLogData): Promise<AuditLog>;
  findForTarget(targetType: string, targetId: string): Promise<AuditLog[]>;
}

export function createAuditLogRepository(db: PrismaClient): AuditLogRepository {
  return {
    async create(data) {
      return db.auditLog.create({ data });
    },

    async findForTarget(targetType, targetId) {
      return db.auditLog.findMany({
        where: { targetType, targetId },
        orderBy: { createdAt: 'desc' },
      });
    },
  };
}

export const AuditLogRepository = createAuditLogRepository(prisma);
