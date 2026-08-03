import type { PrismaClient, SnapshotObject } from '@prisma/client';
import type { CreateSnapshotObjectItem } from '@novel-agent/core';
import { prisma } from './prisma.js';

export interface SnapshotObjectRepository {
  bulkCreate(snapshotId: string, items: CreateSnapshotObjectItem[]): Promise<SnapshotObject[]>;
  listForSnapshot(snapshotId: string): Promise<SnapshotObject[]>;
  countByObject(objectId: string): Promise<number>;
  /** 删除某快照的全部对象关联（仅 building 状态下用于幂等重试清理）。 */
  deleteForSnapshot(snapshotId: string): Promise<number>;
}

export function createSnapshotObjectRepository(db: PrismaClient): SnapshotObjectRepository {
  return {
    async bulkCreate(snapshotId, items) {
      return db.$transaction(async (tx) => {
        const created: SnapshotObject[] = [];
        for (const item of items) {
          created.push(
            await tx.snapshotObject.create({
              data: {
                snapshotId,
                objectId: item.objectId,
                logicalPath: item.logicalPath,
                category: item.category,
                state: item.state,
                reason: item.reason,
              },
            }),
          );
        }
        return created;
      });
    },

    async listForSnapshot(snapshotId) {
      return db.snapshotObject.findMany({
        where: { snapshotId },
        orderBy: { logicalPath: 'asc' },
      });
    },

    async countByObject(objectId) {
      return db.snapshotObject.count({ where: { objectId } });
    },

    async deleteForSnapshot(snapshotId) {
      const result = await db.snapshotObject.deleteMany({ where: { snapshotId } });
      return result.count;
    },
  };
}

export const SnapshotObjectRepository = createSnapshotObjectRepository(prisma);
