import { prisma } from './prisma.js';
import type { WorldviewSetting } from '@qunxiang/core';
import type { Prisma, PrismaClient } from '@prisma/client';
import { decodeJsonField, encodeJsonField } from './json-field.js';
import { reviewBucketWhere, type ReviewBucketQuery, type ReviewBucketCounts } from './review-bucket.js';

export interface WorldviewRepository {
  createMany(worldviews: Array<{
    bookId: string;
    name: string;
    aliases: string[];
    category: string;
    description?: string;
    confidence: number;
    chapterRef?: string;
    importanceScore?: number;
    tier?: string;
    mentionCount?: number;
    firstChapter?: number;
    lastChapter?: number;
    chapterAppearances?: number[];
  }>): Promise<number>;
  findByBookId(bookId: string): Promise<WorldviewSetting[]>;
  findByOwnedBookId(bookId: string, ownerId: string): Promise<WorldviewSetting[]>;

  /** 按审核集合查询（主列表/低置信度库/已拒绝列表），过滤、排序、分页、计数同条件。 */
  findByReviewBucket(query: ReviewBucketQuery): Promise<{ worldviews: WorldviewSetting[]; total: number; nextCursor: string | null }>;
  countReviewBuckets(bookId: string, ownerId: string): Promise<ReviewBucketCounts>;
  countByOwnedBookId(bookId: string, ownerId: string): Promise<number>;
  findOwnedById(id: string, ownerId: string): Promise<WorldviewSetting | null>;
  findByOwnedStatus(bookId: string, ownerId: string, status: string): Promise<WorldviewSetting[]>;
  findByOwnedCategory(bookId: string, ownerId: string, category: string): Promise<WorldviewSetting[]>;
  updateOwned(id: string, ownerId: string, data: Partial<WorldviewSetting>): Promise<WorldviewSetting | null>;
  updateOwnedStatus(id: string, ownerId: string, status: string): Promise<WorldviewSetting | null>;
  deleteByBookId(bookId: string): Promise<void>;
}

function parseWorldview(row: Record<string, unknown>): WorldviewSetting {
  return {
    ...row,
    aliases: decodeJsonField(row.aliases, []),
    chapterAppearances: decodeJsonField(row.chapterAppearances, []),
  } as unknown as WorldviewSetting;
}

export function createWorldviewRepository(db: PrismaClient): WorldviewRepository {
  return {
    async createMany(worldviews): Promise<number> {
      if (worldviews.length === 0) return 0;
      const result = await db.worldviewSetting.createMany({
        data: worldviews.map((worldview) => ({
          bookId: worldview.bookId,
          name: worldview.name,
          aliases: encodeJsonField(worldview.aliases),
          category: worldview.category || 'worldview',
          description: worldview.description,
          confidence: worldview.confidence,
          chapterRef: worldview.chapterRef,
          importanceScore: worldview.importanceScore ?? 0,
          tier: worldview.tier ?? 'candidate',
          mentionCount: worldview.mentionCount ?? 0,
          firstChapter: worldview.firstChapter,
          lastChapter: worldview.lastChapter,
          chapterAppearances: encodeJsonField(worldview.chapterAppearances ?? []),
        })),
      });
      return result.count;
    },

    async findByBookId(bookId) {
      const rows = await db.worldviewSetting.findMany({
        where: { bookId },
        orderBy: [{ importanceScore: 'desc' }, { id: 'asc' }],
      });
      return rows.map((row) => parseWorldview(row as unknown as Record<string, unknown>));
    },

    async findByOwnedBookId(bookId, ownerId) {
      const rows = await db.worldviewSetting.findMany({
        where: { bookId, book: { userId: ownerId } },
        orderBy: [{ importanceScore: 'desc' }, { id: 'asc' }],
      });
      return rows.map((row) => parseWorldview(row as unknown as Record<string, unknown>));
    },

    async countByOwnedBookId(bookId, ownerId) {
      return db.worldviewSetting.count({ where: { bookId, book: { userId: ownerId } } });
    },

    async findOwnedById(id, ownerId) {
      const row = await db.worldviewSetting.findFirst({ where: { id, book: { userId: ownerId } } });
      return row ? parseWorldview(row as unknown as Record<string, unknown>) : null;
    },

    async findByOwnedStatus(bookId, ownerId, status) {
      const rows = await db.worldviewSetting.findMany({
        where: { bookId, status, book: { userId: ownerId } },
        orderBy: [{ importanceScore: 'desc' }, { id: 'asc' }],
      });
      return rows.map((row) => parseWorldview(row as unknown as Record<string, unknown>));
    },

    async findByOwnedCategory(bookId, ownerId, category) {
      const rows = await db.worldviewSetting.findMany({
        where: { bookId, category, book: { userId: ownerId } },
        orderBy: [{ importanceScore: 'desc' }, { id: 'asc' }],
      });
      return rows.map((row) => parseWorldview(row as unknown as Record<string, unknown>));
    },


    async findByReviewBucket(query: ReviewBucketQuery): Promise<{ worldviews: WorldviewSetting[]; total: number; nextCursor: string | null }> {
      const bucketWhere = reviewBucketWhere(query.bucket) as Prisma.WorldviewSettingWhereInput;
      const where: Prisma.WorldviewSettingWhereInput = {
        bookId: query.bookId,
        book: { userId: query.ownerId },
        ...bucketWhere,
        ...(query.status ? { status: query.status } : {}),
        ...(query.category ? { category: query.category } : {}),
      };
      const [total, rows] = await Promise.all([
        db.worldviewSetting.count({ where }),
        db.worldviewSetting.findMany({
          where,
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: query.limit ?? 200,
          ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
        }),
      ]);
      const entities = rows.map((r) => parseWorldview(r as unknown as Record<string, unknown>));
      const nextCursor = query.limit && entities.length === query.limit ? entities[entities.length - 1].id : null;
      return { worldviews: entities, total, nextCursor };
    },

    async countReviewBuckets(bookId: string, ownerId: string): Promise<ReviewBucketCounts> {
      const scope = { bookId, book: { userId: ownerId } } as Prisma.WorldviewSettingWhereInput;
      const [main, lowConfidence, rejected] = await Promise.all([
        db.worldviewSetting.count({ where: { ...scope, ...(reviewBucketWhere('MAIN') as Prisma.WorldviewSettingWhereInput) } }),
        db.worldviewSetting.count({ where: { ...scope, ...(reviewBucketWhere('LOW_CONFIDENCE') as Prisma.WorldviewSettingWhereInput) } }),
        db.worldviewSetting.count({ where: { ...scope, ...(reviewBucketWhere('REJECTED') as Prisma.WorldviewSettingWhereInput) } }),
      ]);
      return { MAIN: main, LOW_CONFIDENCE: lowConfidence, REJECTED: rejected };
    },
    async updateOwned(id, ownerId, data) {
      const existing = await db.worldviewSetting.findFirst({ where: { id, book: { userId: ownerId } } });
      if (!existing) return null;
      const updateData: Record<string, unknown> = { ...data };
      if (data.aliases) updateData.aliases = encodeJsonField(data.aliases);
      if (data.chapterAppearances) updateData.chapterAppearances = encodeJsonField(data.chapterAppearances);
      const result = await db.worldviewSetting.updateMany({
        where: { id, book: { userId: ownerId } },
        data: updateData,
      });
      if (result.count !== 1) return null;
      const updated = await db.worldviewSetting.findFirst({ where: { id, book: { userId: ownerId } } });
      return updated ? parseWorldview(updated as unknown as Record<string, unknown>) : null;
    },

    async updateOwnedStatus(id, ownerId, status) {
      const result = await db.worldviewSetting.updateMany({
        where: { id, book: { userId: ownerId } },
        data: { status },
      });
      if (result.count !== 1) return null;
      const updated = await db.worldviewSetting.findFirst({ where: { id, book: { userId: ownerId } } });
      return updated ? parseWorldview(updated as unknown as Record<string, unknown>) : null;
    },

    async deleteByBookId(bookId) {
      await db.worldviewSetting.deleteMany({ where: { bookId } });
    },
  };
}

export const WorldviewRepository = createWorldviewRepository(prisma);
