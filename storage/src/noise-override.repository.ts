import { prisma } from './prisma.js';
import type { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';

export interface NoiseOverride {
  id: string;
  bookId: string;
  lineNum: number;
  action: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface NoiseOverrideRepository {
  /** 列出某本书的全部覆盖项（找回行）。 */
  listByBook(bookId: string): Promise<NoiseOverride[]>;
  listByOwnedBook(bookId: string, ownerId: string): Promise<NoiseOverride[]>;
  /** 返回某本书所有被「找回」的行号集合，供清洗重算时排除删除。 */
  listKeepLineNums(bookId: string): Promise<Set<number>>;
  listOwnedKeepLineNums(bookId: string, ownerId: string): Promise<Set<number>>;
  /** 标记某行为「找回」（不删除），已存在则幂等。 */
  upsertKeep(bookId: string, lineNum: number): Promise<void>;
  upsertOwnedKeep(bookId: string, ownerId: string, lineNum: number): Promise<boolean>;
  /** 取消某行的「找回」标记。 */
  remove(bookId: string, lineNum: number): Promise<void>;
  removeOwned(bookId: string, ownerId: string, lineNum: number): Promise<boolean>;
}

export function createNoiseOverrideRepository(db: PrismaClient): NoiseOverrideRepository {
  return {
    async listByBook(bookId: string): Promise<NoiseOverride[]> {
      return db.noiseOverride.findMany({
        where: { bookId },
        orderBy: { lineNum: 'asc' },
      }) as Promise<NoiseOverride[]>;
    },

    async listByOwnedBook(bookId: string, ownerId: string): Promise<NoiseOverride[]> {
      return db.noiseOverride.findMany({
        where: { bookId, book: { userId: ownerId } },
        orderBy: { lineNum: 'asc' },
      }) as Promise<NoiseOverride[]>;
    },

    async listKeepLineNums(bookId: string): Promise<Set<number>> {
      const rows = await db.noiseOverride.findMany({
        where: { bookId, action: 'keep' },
        select: { lineNum: true },
      });
      return new Set(rows.map((r) => r.lineNum));
    },

    async listOwnedKeepLineNums(bookId: string, ownerId: string): Promise<Set<number>> {
      const rows = await db.noiseOverride.findMany({
        where: { bookId, action: 'keep', book: { userId: ownerId } },
        select: { lineNum: true },
      });
      return new Set(rows.map((row) => row.lineNum));
    },

    async upsertKeep(bookId: string, lineNum: number): Promise<void> {
      await db.noiseOverride.upsert({
        where: { bookId_lineNum: { bookId, lineNum } },
        create: { bookId, lineNum, action: 'keep' },
        update: { action: 'keep' },
      });
    },

    async upsertOwnedKeep(bookId: string, ownerId: string, lineNum: number): Promise<boolean> {
      const changed = await db.$executeRaw`
        INSERT INTO "NoiseOverride" ("id", "bookId", "lineNum", "action", "createdAt", "updatedAt")
        SELECT ${randomUUID()}::uuid, ${bookId}::uuid, ${lineNum}, 'keep', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        FROM "Book"
        WHERE "id" = ${bookId}::uuid AND "userId" = ${ownerId}::uuid
        ON CONFLICT ("bookId", "lineNum")
        DO UPDATE SET "action" = 'keep', "updatedAt" = CURRENT_TIMESTAMP
      `;
      return changed > 0;
    },

    async remove(bookId: string, lineNum: number): Promise<void> {
      try {
        await db.noiseOverride.delete({
          where: { bookId_lineNum: { bookId, lineNum } },
        });
      } catch {
        // 不存在则忽略
      }
    },

    async removeOwned(bookId: string, ownerId: string, lineNum: number): Promise<boolean> {
      const result = await db.noiseOverride.deleteMany({
        where: { bookId, lineNum, book: { userId: ownerId } },
      });
      return result.count === 1;
    },
  };
}

export const NoiseOverrideRepository = createNoiseOverrideRepository(prisma);
