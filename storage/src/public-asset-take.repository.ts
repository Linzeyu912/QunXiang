import type { PublicAssetTake, PrismaClient } from '@prisma/client';
import { prisma } from './prisma.js';

export interface CreatePublicAssetTakeInput {
  publicAssetId: string;
  takerId: string;
  targetBookId: string;
}

export interface PublicAssetTakeRow {
  id: string;
  publicAssetId: string;
  takerId: string;
  targetBookId: string;
  createdAt: Date;
}

/** 拿取记录仓库。同一素材可拿取到不同书；拿取到同一本书按查重提示。 */
export interface PublicAssetTakeRepository {
  create(input: CreatePublicAssetTakeInput): Promise<PublicAssetTakeRow>;
  /** 是否已拿取到同一本书（防重复提示用）。 */
  findExisting(publicAssetId: string, takerId: string, targetBookId: string): Promise<boolean>;
}

function toRow(row: PublicAssetTake): PublicAssetTakeRow {
  return {
    id: row.id,
    publicAssetId: row.publicAssetId,
    takerId: row.takerId,
    targetBookId: row.targetBookId,
    createdAt: row.createdAt,
  };
}

export function createPublicAssetTakeRepository(db: PrismaClient): PublicAssetTakeRepository {
  return {
    async create(input) {
      const row = await db.publicAssetTake.create({
        data: {
          publicAssetId: input.publicAssetId,
          takerId: input.takerId,
          targetBookId: input.targetBookId,
        },
      });
      return toRow(row);
    },

    async findExisting(publicAssetId, takerId, targetBookId) {
      const count = await db.publicAssetTake.count({
        where: { publicAssetId, takerId, targetBookId },
      });
      return count > 0;
    },
  };
}

export const PublicAssetTakeRepository = createPublicAssetTakeRepository(prisma);
