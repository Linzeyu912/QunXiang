import type { BookArtifact, PrismaClient } from '@prisma/client';
import { prisma } from './prisma.js';

export interface UpsertBookArtifactInput {
  bookId: string;
  logicalPath: string;
  category: string;
  objectKey: string;
  sha256: string;
  bytes: bigint;
  mime: string;
  /** 产物基于的原文版本（可选，实施包 C4） */
  sourceRevision?: number;
  extractionSessionId?: string;
}

export interface BookArtifactRepository {
  /** 按 (bookId, logicalPath) upsert：新产物覆盖旧（最新 run / 最新编辑胜）。 */
  upsert(input: UpsertBookArtifactInput): Promise<BookArtifact>;
  findByBook(bookId: string): Promise<BookArtifact[]>;
  findByBookAndPath(bookId: string, logicalPath: string): Promise<BookArtifact | null>;
  findByBookAndCategory(bookId: string, category: string): Promise<BookArtifact[]>;
  deleteForBook(bookId: string): Promise<number>;
}

export function createBookArtifactRepository(db: PrismaClient): BookArtifactRepository {
  return {
    async upsert(input) {
      return db.bookArtifact.upsert({
        where: { bookId_logicalPath: { bookId: input.bookId, logicalPath: input.logicalPath } },
        update: {
          category: input.category,
          objectKey: input.objectKey,
          sha256: input.sha256,
          bytes: input.bytes,
          mime: input.mime,
          ...(input.sourceRevision !== undefined ? { sourceRevision: input.sourceRevision } : {}),
          ...(input.extractionSessionId !== undefined ? { extractionSessionId: input.extractionSessionId } : {}),
        },
        create: { ...input },
      });
    },

    async findByBook(bookId) {
      return db.bookArtifact.findMany({ where: { bookId }, orderBy: { logicalPath: 'asc' } });
    },

    async findByBookAndPath(bookId, logicalPath) {
      return db.bookArtifact.findUnique({
        where: { bookId_logicalPath: { bookId, logicalPath } },
      });
    },

    async findByBookAndCategory(bookId, category) {
      return db.bookArtifact.findMany({
        where: { bookId, category },
        orderBy: { logicalPath: 'asc' },
      });
    },

    async deleteForBook(bookId) {
      const r = await db.bookArtifact.deleteMany({ where: { bookId } });
      return r.count;
    },
  };
}

export const BookArtifactRepository = createBookArtifactRepository(prisma);
