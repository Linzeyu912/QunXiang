import type { PublicAssetImage, PrismaClient } from '@prisma/client';
import { prisma } from './prisma.js';

export interface CreatePublicAssetImageInput {
  publicAssetId: string;
  assetObjectId: string;
  objectKey: string;
  mime: string;
  bytes: number;
  aspectRatio?: string | null;
  stage?: string | null;
  isPrimary: boolean;
  sortOrder: number;
}

export interface PublicAssetImageRow {
  id: string;
  publicAssetId: string;
  assetObjectId: string;
  objectKey: string;
  mime: string;
  bytes: number;
  aspectRatio: string | null;
  stage: string | null;
  isPrimary: boolean;
  sortOrder: number;
}

/** 公共素材图片引用仓库。字节不复制，指向 AssetObject（内容寻址）。 */
export interface PublicAssetImageRepository {
  createMany(images: CreatePublicAssetImageInput[]): Promise<void>;
  findByPublicAssetId(publicAssetId: string): Promise<PublicAssetImageRow[]>;
  /** 批量查多个素材的主图（列表页缩略图）。返回 Map<publicAssetId, image>。 */
  findPrimaryByAssetIds(assetIds: string[]): Promise<Map<string, PublicAssetImageRow>>;
}

function toRow(row: PublicAssetImage): PublicAssetImageRow {
  return {
    id: row.id,
    publicAssetId: row.publicAssetId,
    assetObjectId: row.assetObjectId,
    objectKey: row.objectKey,
    mime: row.mime,
    bytes: row.bytes,
    aspectRatio: row.aspectRatio,
    stage: row.stage,
    isPrimary: row.isPrimary,
    sortOrder: row.sortOrder,
  };
}

export function createPublicAssetImageRepository(db: PrismaClient): PublicAssetImageRepository {
  return {
    async createMany(images) {
      if (images.length === 0) return;
      await db.publicAssetImage.createMany({
        data: images.map((img) => ({
          publicAssetId: img.publicAssetId,
          assetObjectId: img.assetObjectId,
          objectKey: img.objectKey,
          mime: img.mime,
          bytes: img.bytes,
          aspectRatio: img.aspectRatio ?? null,
          stage: img.stage ?? null,
          isPrimary: img.isPrimary,
          sortOrder: img.sortOrder,
        })),
      });
    },

    async findByPublicAssetId(publicAssetId) {
      const rows = await db.publicAssetImage.findMany({
        where: { publicAssetId },
        orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }, { id: 'asc' }],
      });
      return rows.map(toRow);
    },

    async findPrimaryByAssetIds(assetIds) {
      if (assetIds.length === 0) return new Map();
      // 优先取 isPrimary=true 的；没有则取排序最早的一张
      const primary = await db.publicAssetImage.findMany({
        where: { publicAssetId: { in: assetIds }, isPrimary: true },
      });
      const map = new Map<string, PublicAssetImageRow>();
      for (const row of primary) {
        map.set(row.publicAssetId, toRow(row));
      }
      // 对没有主图的素材，取第一张
      const missing = assetIds.filter((id) => !map.has(id));
      if (missing.length > 0) {
        const fallback = await db.publicAssetImage.findMany({
          where: { publicAssetId: { in: missing } },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        });
        // 每个 publicAssetId 只取第一张
        for (const row of fallback) {
          if (!map.has(row.publicAssetId)) {
            map.set(row.publicAssetId, toRow(row));
          }
        }
      }
      return map;
    },
  };
}

export const PublicAssetImageRepository = createPublicAssetImageRepository(prisma);
