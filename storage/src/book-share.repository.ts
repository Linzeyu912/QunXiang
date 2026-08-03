import type { BookShare, PrismaClient } from '@prisma/client';
import { prisma } from './prisma.js';

export interface CreateBookShareInput {
  bookId: string;
  snapshotId: string;
  senderId: string;
  recipientId: string;
}

/** 非撤销状态集合：同一书+接收方最多一个。 */
const ACTIVE_STATUSES = ['active', 'copying', 'copied'] as const;

export interface BookShareRepository {
  /** 同书+接收方已有非撤销分享则复用，否则新建 active。 */
  create(input: CreateBookShareInput): Promise<BookShare>;
  findOwnedById(id: string, senderId: string): Promise<BookShare | null>;
  findForRecipient(id: string, recipientId: string): Promise<BookShare | null>;
  findActiveByBookAndRecipient(bookId: string, recipientId: string): Promise<BookShare | null>;
  findSharedWithMe(recipientId: string): Promise<BookShare[]>;
  /** 发送者撤销：active→revoked。返回更新后的行或 null（不存在/非 active/非本人）。 */
  revoke(id: string, senderId: string, now?: Date): Promise<BookShare | null>;
  /** 接收方领取复制：条件 active+snapshotId+recipientId→copying。返回是否成功（竞态中撤销先成功则 false）。 */
  markCopying(id: string, recipientId: string, snapshotId: string, now?: Date): Promise<boolean>;
  /** 复制完成：copying+recipientId→copied。 */
  markCopied(id: string, recipientId: string, now?: Date): Promise<BookShare | null>;
  /** 复制失败回滚：copying→active（恢复可重试）。 */
  markFailed(id: string, reason: string, now?: Date): Promise<BookShare | null>;
}

export function createBookShareRepository(db: PrismaClient): BookShareRepository {
  return {
    async create(input) {
      const filter = {
        bookId: input.bookId,
        recipientId: input.recipientId,
        status: { in: [...ACTIVE_STATUSES] },
      };
      const existing = await db.bookShare.findFirst({ where: filter });
      if (existing) {
        // 复用时刷新到最新 ready 快照（P1-1：避免发送者重新准备后仍分享旧快照）
        if (existing.snapshotId !== input.snapshotId) {
          await db.bookShare.update({ where: { id: existing.id }, data: { snapshotId: input.snapshotId } });
          return db.bookShare.findUniqueOrThrow({ where: { id: existing.id } });
        }
        return existing;
      }
      try {
        return await db.bookShare.create({
          data: {
            bookId: input.bookId,
            snapshotId: input.snapshotId,
            senderId: input.senderId,
            recipientId: input.recipientId,
            status: 'active',
          },
        });
      } catch (err) {
        // 并发下另一请求可能已建；partial unique 约束触发 P2002，回读复用（P0-1）
        if ((err as { code?: string }).code === 'P2002') {
          const concurrent = await db.bookShare.findFirst({ where: filter });
          if (concurrent) return concurrent;
        }
        throw err;
      }
    },

    async findOwnedById(id, senderId) {
      return db.bookShare.findFirst({ where: { id, senderId } });
    },

    async findForRecipient(id, recipientId) {
      return db.bookShare.findFirst({ where: { id, recipientId } });
    },

    async findActiveByBookAndRecipient(bookId, recipientId) {
      return db.bookShare.findFirst({
        where: { bookId, recipientId, status: { in: [...ACTIVE_STATUSES] } },
      });
    },

    async findSharedWithMe(recipientId) {
      return db.bookShare.findMany({
        where: { recipientId },
        include: {
          book: { select: { id: true, title: true } },
          snapshot: { select: { version: true, readyAt: true, archiveObjectId: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      });
    },

    async revoke(id, senderId, now = new Date()) {
      const r = await db.bookShare.updateMany({
        where: { id, senderId, status: 'active' },
        data: { status: 'revoked', revokedAt: now },
      });
      return r.count > 0 ? db.bookShare.findUnique({ where: { id } }) : null;
    },

    async markCopying(id, recipientId, snapshotId, now = new Date()) {
      const r = await db.bookShare.updateMany({
        where: { id, recipientId, snapshotId, status: 'active' },
        data: { status: 'copying', claimedAt: now },
      });
      return r.count === 1;
    },

    async markCopied(id, recipientId, now = new Date()) {
      const r = await db.bookShare.updateMany({
        where: { id, recipientId, status: 'copying' },
        data: { status: 'copied', copiedAt: now, failureReason: null },
      });
      return r.count > 0 ? db.bookShare.findUnique({ where: { id } }) : null;
    },

    async markFailed(id, reason, now = new Date()) {
      const r = await db.bookShare.updateMany({
        where: { id, status: 'copying' },
        data: { status: 'active', failureReason: reason, claimedAt: null },
      });
      return r.count > 0 ? db.bookShare.findUnique({ where: { id } }) : null;
    },
  };
}

export const BookShareRepository = createBookShareRepository(prisma);
