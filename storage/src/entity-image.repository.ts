import { prisma } from './prisma.js';
import type { PrismaClient } from '@prisma/client';

export type EntityImageSource = 'generated' | 'uploaded';

export interface EntityImageRow {
  id: string;
  bookId: string;
  entityType: string;
  entityName: string;
  filePath: string;
  objectKey?: string | null;
  mime: string;
  ext: string;
  bytes: number;
  aspectRatio: string | null;
  source: string; // 'generated' | 'uploaded'（DB 存 string，service 层窄化）
  stage: string | null; // 生图所用年龄阶段（仅 character 有值；item/location/null）
  isPrimary: boolean;
  sortOrder: number;
  createdAt: Date;
}

export interface CreateEntityImageData {
  bookId: string;
  entityType: string;
  entityName: string;
  filePath: string;
  objectKey?: string | null;
  mime: string;
  ext: string;
  bytes: number;
  aspectRatio?: string | null;
  source: EntityImageSource;
  stage?: string | null;
}

/**
 * 实体图片持久化仓库。图片与提取 runDir 解耦——按 bookId+entityType+entityName 索引，
 * 文件名只用 id（uuid），重跑管道不丢。
 *
 * 主图语义：同一实体至多一张 isPrimary=true。首张自动主图；删主图后提升最早一张。
 */
export interface EntityImageRepository {
  create(data: CreateEntityImageData): Promise<EntityImageRow>;
  findManyByEntity(bookId: string, entityType: string, entityName: string): Promise<EntityImageRow[]>;
  findManyByOwnedEntity(bookId: string, ownerId: string, entityType: string, entityName: string): Promise<EntityImageRow[]>;
  findById(id: string): Promise<EntityImageRow | null>;
  findOwnedById(id: string, bookId: string, ownerId: string): Promise<EntityImageRow | null>;
  findByBookId(bookId: string): Promise<EntityImageRow[]>;
  deleteById(id: string): Promise<void>;
  deleteOwnedById(id: string, bookId: string, ownerId: string): Promise<boolean>;
  setPrimary(imageId: string): Promise<EntityImageRow | null>;
  setOwnedPrimary(imageId: string, bookId: string, ownerId: string): Promise<EntityImageRow | null>;
  promoteOldestPrimary(bookId: string, entityType: string, entityName: string): Promise<void>;
}

export function createEntityImageRepository(db: PrismaClient): EntityImageRepository {
  return {
    // 首张自动主图；事务保证 count + insert 原子，避免并发产生多主图。
    async create(data: CreateEntityImageData): Promise<EntityImageRow> {
      return db.$transaction(async (tx) => {
        const count = await tx.entityImage.count({
          where: { bookId: data.bookId, entityType: data.entityType, entityName: data.entityName },
        });
        return tx.entityImage.create({
          data: {
            bookId: data.bookId,
            entityType: data.entityType,
            entityName: data.entityName,
            filePath: data.filePath,
            objectKey: data.objectKey,
            mime: data.mime,
            ext: data.ext,
            bytes: data.bytes,
            aspectRatio: data.aspectRatio ?? null,
            source: data.source,
            stage: data.stage ?? null,
            isPrimary: count === 0,
          },
        });
      });
    },

    // 画廊顺序：主图优先，其次按创建时间升序。
    async findManyByEntity(bookId, entityType, entityName): Promise<EntityImageRow[]> {
      return db.entityImage.findMany({
        where: { bookId, entityType, entityName },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      });
    },

    async findById(id): Promise<EntityImageRow | null> {
      return db.entityImage.findUnique({ where: { id } });
    },

    async findManyByOwnedEntity(bookId, ownerId, entityType, entityName): Promise<EntityImageRow[]> {
      return db.entityImage.findMany({
        where: { bookId, entityType, entityName, book: { userId: ownerId } },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      });
    },

    async findOwnedById(id, bookId, ownerId): Promise<EntityImageRow | null> {
      return db.entityImage.findFirst({
        where: { id, bookId, book: { userId: ownerId } },
      });
    },

    async findByBookId(bookId): Promise<EntityImageRow[]> {
      return db.entityImage.findMany({
        where: { bookId },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
      });
    },

    async deleteById(id): Promise<void> {
      await db.entityImage.delete({ where: { id } });
    },

    async deleteOwnedById(id, bookId, ownerId): Promise<boolean> {
      const result = await db.entityImage.deleteMany({
        where: { id, bookId, book: { userId: ownerId } },
      });
      return result.count === 1;
    },

    // 事务：先清同实体其他主图，再置目标张。目标不存在返回 null。
    async setPrimary(imageId): Promise<EntityImageRow | null> {
      return db.$transaction(async (tx) => {
        const target = await tx.entityImage.findUnique({ where: { id: imageId } });
        if (!target) return null;
        await tx.entityImage.updateMany({
          where: {
            bookId: target.bookId,
            entityType: target.entityType,
            entityName: target.entityName,
            isPrimary: true,
            id: { not: imageId },
          },
          data: { isPrimary: false },
        });
        return tx.entityImage.update({ where: { id: imageId }, data: { isPrimary: true } });
      });
    },

    async setOwnedPrimary(imageId, bookId, ownerId): Promise<EntityImageRow | null> {
      return db.$transaction(async (tx) => {
        const target = await tx.entityImage.findFirst({
          where: { id: imageId, bookId, book: { userId: ownerId } },
        });
        if (!target) return null;
        await tx.entityImage.updateMany({
          where: {
            bookId,
            book: { userId: ownerId },
            entityType: target.entityType,
            entityName: target.entityName,
            isPrimary: true,
            id: { not: imageId },
          },
          data: { isPrimary: false },
        });
        const result = await tx.entityImage.updateMany({
          where: { id: imageId, bookId, book: { userId: ownerId } },
          data: { isPrimary: true },
        });
        return result.count === 1 ? { ...target, isPrimary: true } : null;
      });
    },

    // 删主图后兜底：若无主图且仍有图，把最早一张提升为主图。
    async promoteOldestPrimary(bookId, entityType, entityName): Promise<void> {
      const hasPrimary = await db.entityImage.findFirst({
        where: { bookId, entityType, entityName, isPrimary: true },
      });
      if (hasPrimary) return;
      const oldest = await db.entityImage.findFirst({
        where: { bookId, entityType, entityName },
        orderBy: { createdAt: 'asc' },
      });
      if (oldest) {
        await db.entityImage.update({ where: { id: oldest.id }, data: { isPrimary: true } });
      }
    },
  };
}

export const EntityImageRepository = createEntityImageRepository(prisma);
