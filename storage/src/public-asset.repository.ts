import type { PublicAsset, Prisma, PrismaClient } from '@prisma/client';
import { prisma } from './prisma.js';

export type PublicAssetKind = 'character' | 'location' | 'item';

export interface CreatePublicAssetInput {
  publisherId: string;
  kind: string;
  name: string;
  summary?: string | null;
  tags: string[];
  payload: Prisma.InputJsonValue;
}

export interface PublicAssetListQuery {
  kind?: string;
  tags?: string[]; // 多标签 AND 筛选
  q?: string; // 名称/简介模糊
  sort?: 'new' | 'hot'; // 默认 new
  cursor?: { createdAt: Date; id: string } | null;
  limit?: number;
}

export interface PublicAssetListItem {
  id: string;
  publisherId: string;
  kind: string;
  name: string;
  summary: string | null;
  tags: string[];
  status?: string;
  takenCount: number;
  createdAt: Date;
}

export interface PublicAssetListResult {
  items: PublicAssetListItem[];
  nextCursor: { createdAt: Date; id: string } | null;
}

/**
 * 公共素材仓库。payload 自包含（不可变快照）；status=published 才对外可见。
 *
 * 游标分页：(createdAt DESC, id DESC) 复合游标，保证稳定排序无重复无遗漏。
 * 列表查询不含 payload 全文，仅返回摘要字段（列表页用）。
 */
export interface PublicAssetRepository {
  create(input: CreatePublicAssetInput): Promise<PublicAsset>;
  findPublished(query: PublicAssetListQuery): Promise<PublicAssetListResult>;
  findByPublisher(publisherId: string): Promise<PublicAssetListItem[]>;
  findPublishedById(id: string): Promise<PublicAsset | null>;
  findById(id: string): Promise<PublicAsset | null>;
  findOwnedById(id: string, publisherId: string): Promise<PublicAsset | null>;
  unlist(id: string, publisherId: string): Promise<boolean>;
  incrementTakenCount(id: string): Promise<void>;
  aggregateTags(limit?: number): Promise<{ tag: string; count: number }[]>;
}

const PAGE_SIZE = 20;

const LIST_SELECT = {
  id: true,
  publisherId: true,
  kind: true,
  name: true,
  summary: true,
  tags: true,
  status: true,
  takenCount: true,
  createdAt: true,
} as const;

function toListItem(row: { id: string; publisherId: string; kind: string; name: string; summary: string | null; tags: unknown; status?: string; takenCount: number; createdAt: Date }): PublicAssetListItem {
  return {
    id: row.id,
    publisherId: row.publisherId,
    kind: row.kind,
    name: row.name,
    summary: row.summary,
    tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
    status: row.status,
    takenCount: row.takenCount,
    createdAt: row.createdAt,
  };
}

export function createPublicAssetRepository(db: PrismaClient): PublicAssetRepository {
  return {
    async create(input) {
      return db.publicAsset.create({
        data: {
          publisherId: input.publisherId,
          kind: input.kind,
          name: input.name,
          summary: input.summary ?? null,
          tags: input.tags,
          payload: input.payload,
          status: 'published',
        },
      });
    },

    async findPublished(query) {
      const limit = Math.min(query.limit ?? PAGE_SIZE, PAGE_SIZE);
      const where: Prisma.PublicAssetWhereInput = { status: 'published' };
      if (query.kind) where.kind = query.kind;
      // 多标签 AND 筛选：素材必须同时包含所有选中标签
      if (query.tags && query.tags.length > 0) {
        where.AND = query.tags.map((t) => ({ tags: { array_contains: t } }));
      }
      if (query.q) {
        where.OR = [
          { name: { contains: query.q, mode: 'insensitive' } },
          { summary: { contains: query.q, mode: 'insensitive' } },
        ];
      }

      const orderBy: Prisma.PublicAssetOrderByWithRelationInput[] =
        query.sort === 'hot'
          ? [{ takenCount: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }]
          : [{ createdAt: 'desc' }, { id: 'desc' }];

      // 游标分页：hot 排序用 takenCount+createdAt+id 复合游标；new 排序用 createdAt+id
      let cursor: Prisma.PublicAssetWhereInput | undefined;
      if (query.cursor) {
        if (query.sort === 'hot') {
          // hot 模式下游标需带入 takenCount，但为简化，这里游标改用 offset 兜底
          // 由于热榜数据变化频繁，MVP 用 createdAt+id 兜底（取该游标对应行）
          const cursorRow = await db.publicAsset.findUnique({
            where: { id: query.cursor.id },
            select: { takenCount: true, createdAt: true, id: true },
          });
          if (cursorRow) {
            cursor = {
              OR: [
                { takenCount: { lt: cursorRow.takenCount } },
                {
                  takenCount: cursorRow.takenCount,
                  createdAt: { lt: cursorRow.createdAt },
                },
                {
                  takenCount: cursorRow.takenCount,
                  createdAt: cursorRow.createdAt,
                  id: { lt: cursorRow.id },
                },
              ],
            };
          }
        } else {
          cursor = {
            OR: [
              { createdAt: { lt: query.cursor.createdAt } },
              {
                createdAt: query.cursor.createdAt,
                id: { lt: query.cursor.id },
              },
            ],
          };
        }
      }

      const rows = await db.publicAsset.findMany({
        where: { ...where, ...cursor },
        orderBy,
        take: limit + 1,
        select: LIST_SELECT,
      });

      const hasMore = rows.length > limit;
      const sliced = hasMore ? rows.slice(0, limit) : rows;
      const items = sliced.map(toListItem);
      const nextCursor =
        hasMore && items.length > 0
          ? { createdAt: items[items.length - 1].createdAt, id: items[items.length - 1].id }
          : null;

      return { items, nextCursor };
    },

    async findByPublisher(publisherId) {
      const rows = await db.publicAsset.findMany({
        where: { publisherId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: LIST_SELECT,
      });
      return rows.map(toListItem);
    },

    async findPublishedById(id) {
      return db.publicAsset.findFirst({
        where: { id, status: 'published' },
      });
    },

    async findById(id) {
      return db.publicAsset.findUnique({ where: { id } });
    },

    async findOwnedById(id, publisherId) {
      return db.publicAsset.findFirst({ where: { id, publisherId } });
    },

    async unlist(id, publisherId) {
      const r = await db.publicAsset.updateMany({
        where: { id, publisherId, status: 'published' },
        data: { status: 'unlisted' },
      });
      return r.count > 0;
    },

    async incrementTakenCount(id) {
      await db.publicAsset.update({
        where: { id },
        data: { takenCount: { increment: 1 } },
      });
    },

    async aggregateTags(limit = 30) {
      const rows = await db.$queryRaw<{ tag: string; count: number }[]>`
        SELECT tag, COUNT(*)::int AS count
        FROM "PublicAsset",
             jsonb_array_elements_text(tags::jsonb) AS tag
        WHERE status = 'published'
        GROUP BY tag
        ORDER BY count DESC
        LIMIT ${limit}
      `;
      return rows;
    },
  };
}

export const PublicAssetRepository = createPublicAssetRepository(prisma);
