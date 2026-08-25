import type { AssetSnapshot, PrismaClient } from '@prisma/client';
import type { CreateAssetSnapshotInput } from '@qunxiang/core';
import { prisma } from './prisma.js';

export interface AssetSnapshotRepository {
  create(input: CreateAssetSnapshotInput): Promise<AssetSnapshot>;
  findOwnedById(id: string, ownerId: string): Promise<AssetSnapshot | null>;
  findCurrentForBook(bookId: string, ownerId: string): Promise<AssetSnapshot | null>;
  findByBookAndContentRevision(bookId: string, contentRevision: string): Promise<AssetSnapshot | null>;
  markReady(id: string, manifestObjectId: string, now?: Date): Promise<AssetSnapshot | null>;
  markArchived(id: string, archiveObjectId: string, now?: Date): Promise<AssetSnapshot | null>;
  markFailed(id: string, reason: string, now?: Date): Promise<AssetSnapshot | null>;
  deleteById(id: string): Promise<void>;
}

export function createAssetSnapshotRepository(db: PrismaClient): AssetSnapshotRepository {
  return {
    async create(input) {
      return db.$transaction(async (tx) => {
        const max = await tx.assetSnapshot.aggregate({
          where: { bookId: input.bookId },
          _max: { version: true },
        });
        const version = (max._max.version ?? 0) + 1;
        try {
          return await tx.assetSnapshot.create({
            data: {
              bookId: input.bookId,
              ownerId: input.ownerId,
              version,
              contentRevision: input.contentRevision,
              status: 'building',
            },
          });
        } catch {
          throw new Error('该成果版本已存在快照');
        }
      });
    },

    async findOwnedById(id, ownerId) {
      return db.assetSnapshot.findFirst({ where: { id, ownerId } });
    },

    async findCurrentForBook(bookId, ownerId) {
      const book = await db.book.findFirst({
        where: { id: bookId, userId: ownerId },
        select: { currentSnapshotId: true },
      });
      if (!book?.currentSnapshotId) return null;
      return db.assetSnapshot.findFirst({ where: { id: book.currentSnapshotId, ownerId } });
    },

    async findByBookAndContentRevision(bookId, contentRevision) {
      return db.assetSnapshot.findFirst({
        where: { bookId, contentRevision },
      });
    },

    async markReady(id, manifestObjectId, now = new Date()) {
      return db.$transaction(async (tx) => {
        const r = await tx.assetSnapshot.updateMany({
          where: { id, status: 'building' },
          data: { status: 'ready', manifestObjectId, readyAt: now },
        });
        if (r.count === 0) return null;
        return tx.assetSnapshot.findUnique({ where: { id } });
      });
    },

    async markArchived(id, archiveObjectId, _now = new Date()) {
      const r = await db.assetSnapshot.updateMany({
        where: { id, status: 'ready' },
        data: { archiveObjectId },
      });
      if (r.count === 0) return null;
      return db.assetSnapshot.findUnique({ where: { id } });
    },

    async markFailed(id, reason, _now = new Date()) {
      return db.$transaction(async (tx) => {
        const r = await tx.assetSnapshot.updateMany({
          where: { id, status: 'building' },
          data: { status: 'failed', failureReason: reason },
        });
        if (r.count === 0) return null;
        return tx.assetSnapshot.findUnique({ where: { id } });
      });
    },

    async deleteById(id) {
      await db.assetSnapshot.deleteMany({ where: { id } });
    },
  };
}

export const AssetSnapshotRepository = createAssetSnapshotRepository(prisma);
