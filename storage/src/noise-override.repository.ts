import { prisma } from './prisma.js';
import type { PrismaClient } from '@prisma/client';

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
  /** 返回某本书所有被「找回」的行号集合，供清洗重算时排除删除。 */
  listKeepLineNums(bookId: string): Promise<Set<number>>;
  /** 标记某行为「找回」（不删除），已存在则幂等。 */
  upsertKeep(bookId: string, lineNum: number): Promise<void>;
  /** 取消某行的「找回」标记。 */
  remove(bookId: string, lineNum: number): Promise<void>;
}

export function createNoiseOverrideRepository(db: PrismaClient): NoiseOverrideRepository {
  return {
    async listByBook(bookId: string): Promise<NoiseOverride[]> {
      return db.noiseOverride.findMany({
        where: { bookId },
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

    async upsertKeep(bookId: string, lineNum: number): Promise<void> {
      await db.noiseOverride.upsert({
        where: { bookId_lineNum: { bookId, lineNum } },
        create: { bookId, lineNum, action: 'keep' },
        update: { action: 'keep' },
      });
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
  };
}

export const NoiseOverrideRepository = createNoiseOverrideRepository(prisma);
