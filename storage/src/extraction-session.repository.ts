import { prisma } from './prisma.js';
import type { PrismaClient } from '@prisma/client';

/** 活动态集合：一本书同时最多一个（部分唯一索引 ExtractionSession_book_active_unique 兜底）。 */
export const ACTIVE_SESSION_STATUSES = ['QUEUED', 'RUNNING', 'PAUSING', 'PAUSED', 'CANCELLING'] as const;

export interface ExtractionSessionRepository {
  /** 书籍当前活动运行（QUEUED/RUNNING/PAUSING/PAUSED/CANCELLING），无则 null。 */
  findActiveByBook(bookId: string): Promise<Record<string, unknown> | null>;
  findById(id: string): Promise<Record<string, unknown> | null>;
  /** 最近一次成功发布（COMPLETED + promotedAt）的运行。 */
  findLatestPromotedByBook(bookId: string): Promise<Record<string, unknown> | null>;
  /** 排队在前方的其他活动运行数（D5：启动前显示队列前方运行数）。 */
  countActiveAhead(bookId: string): Promise<number>;
  create(data: {
    bookId: string;
    userId: string;
    kind?: string;
    status?: string;
    sourceRevision?: number;
    estimatedInputChars?: bigint;
    estimatedCalls?: number;
    maxCalls?: number;
    maxTokens?: number;
    manifest?: unknown;
  }): Promise<{ id: string }>;
  markRunning(id: string): Promise<void>;
  markPaused(id: string, resumeFrom?: string, stageResults?: unknown): Promise<void>;
  /** 仅 PAUSED 可恢复；条件更新，竞态下（如已取消）返回 false 不覆写。 */
  markResumed(id: string): Promise<boolean>;
  markCancelling(id: string): Promise<void>;
  markCancelled(id: string): Promise<void>;
  markCompleted(id: string, usageSummary?: unknown): Promise<void>;
  markFailed(id: string, reason: string): Promise<void>;
}

function asRow(row: unknown): Record<string, unknown> | null {
  return (row as Record<string, unknown>) ?? null;
}

export function createExtractionSessionRepository(db: PrismaClient): ExtractionSessionRepository {
  return {
    async findActiveByBook(bookId) {
      return asRow(
        await db.extractionSession.findFirst({
          where: { bookId, status: { in: [...ACTIVE_SESSION_STATUSES] } },
          orderBy: { createdAt: 'desc' },
        }),
      );
    },
    async findById(id) {
      return asRow(await db.extractionSession.findUnique({ where: { id } }));
    },
    async findLatestPromotedByBook(bookId) {
      return asRow(
        await db.extractionSession.findFirst({
          where: { bookId, status: 'COMPLETED', promotedAt: { not: null } },
          orderBy: { promotedAt: 'desc' },
        }),
      );
    },
    async countActiveAhead(bookId) {
      const self = await db.extractionSession.findFirst({
        where: { bookId, status: { in: [...ACTIVE_SESSION_STATUSES] } },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      });
      if (!self) return 0;
      return db.extractionSession.count({
        where: {
          bookId: { not: bookId },
          status: { in: ['QUEUED', 'RUNNING'] },
          createdAt: { lt: self.createdAt },
        },
      });
    },
    async create(data) {
      const row = await db.extractionSession.create({
        data: {
          bookId: data.bookId,
          userId: data.userId,
          kind: data.kind ?? 'LIVE',
          status: data.status ?? 'QUEUED',
          sourceRevision: data.sourceRevision ?? 0,
          estimatedInputChars: data.estimatedInputChars,
          estimatedCalls: data.estimatedCalls,
          maxCalls: data.maxCalls,
          maxTokens: data.maxTokens,
          manifest: (data.manifest ?? undefined) as object | undefined,
        },
        select: { id: true },
      });
      return row;
    },
    async markRunning(id) {
      await db.extractionSession.updateMany({
        where: { id, status: { in: ['QUEUED', 'PAUSED'] } },
        data: { status: 'RUNNING', startedAt: new Date() },
      });
    },
    async markPaused(id, resumeFrom, stageResults) {
      // 条件更新：仅活动态可暂停落盘；会话已被并发取消/完成时不覆写终态。
      await db.extractionSession.updateMany({
        where: { id, status: { in: [...ACTIVE_SESSION_STATUSES] } },
        data: {
          status: 'PAUSED',
          manifest: {
            resumeFrom,
            stageResults,
            pausedAt: new Date().toISOString(),
          } as object,
        },
      });
    },
    async markResumed(id) {
      const updated = await db.extractionSession.updateMany({
        where: { id, status: 'PAUSED' },
        data: { status: 'RUNNING' },
      });
      return updated.count === 1;
    },
    async markCancelling(id) {
      await db.extractionSession.updateMany({
        where: { id, status: { in: ['QUEUED', 'RUNNING', 'PAUSING', 'PAUSED'] } },
        data: { status: 'CANCELLING', cancelRequestedAt: new Date() },
      });
    },
    async markCancelled(id) {
      await db.extractionSession.update({
        where: { id },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      });
    },
    async markCompleted(id, usageSummary) {
      const now = new Date();
      await db.extractionSession.update({
        where: { id },
        data: { status: 'COMPLETED', completedAt: now, promotedAt: now, usageSummary: (usageSummary ?? undefined) as object | undefined },
      });
    },
    async markFailed(id, reason) {
      await db.extractionSession.update({
        where: { id },
        data: { status: 'FAILED', failureReason: reason ?? null, completedAt: new Date() },
      });
    },
  };
}

export const ExtractionSessionRepository = createExtractionSessionRepository(prisma);
