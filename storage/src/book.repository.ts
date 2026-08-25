import { prisma } from './prisma.js';
import type { Book } from '@qunxiang/core';
import type { PrismaClient } from '@prisma/client';
import { unlink } from 'fs/promises';
import { withDatabaseRetry } from './database-retry.js';

export interface BookRepository {
  create(data: { title: string; filePath: string; fileSize: number; mimeType: string; userId: string; sourceObjectKey?: string }): Promise<Book>;
  findById(id: string): Promise<Book | null>;
  findOwnedById(id: string, ownerId: string): Promise<Book | null>;
  findAll(userId: string): Promise<Book[]>;
  updateStatus(id: string, status: string): Promise<Book>;
  setCurrentSnapshot(id: string, snapshotId: string | null): Promise<void>;
  updateOwnedStatus(id: string, ownerId: string, status: string): Promise<Book | null>;
  delete(id: string): Promise<void>;
  deleteOwned(id: string, ownerId: string): Promise<boolean>;
}

export function createBookRepository(db: PrismaClient): BookRepository {
  return {
    async create(data: { title: string; filePath: string; fileSize: number; mimeType: string; userId: string; sourceObjectKey?: string }): Promise<Book> {
      return withDatabaseRetry(() => db.book.create({ data }) as Promise<Book>);
    },

    async findById(id: string): Promise<Book | null> {
      return db.book.findUnique({ where: { id } }) as Promise<Book | null>;
    },

    async findOwnedById(id: string, ownerId: string): Promise<Book | null> {
      return db.book.findFirst({ where: { id, userId: ownerId } }) as Promise<Book | null>;
    },

    async findAll(userId: string): Promise<Book[]> {
      return db.book.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      }) as Promise<Book[]>;
    },

    async updateStatus(id: string, status: string): Promise<Book> {
      return db.book.update({
        where: { id },
        data: { status },
      }) as Promise<Book>;
    },

    async setCurrentSnapshot(id: string, snapshotId: string | null): Promise<void> {
      // 用原生 SQL 绕过 Prisma @updatedAt：currentSnapshotId 是非内容性指针，
      // 不应刷新 book.updatedAt（否则 contentRevision 漂移导致 needs-update 死循环）。
      await db.$executeRaw`UPDATE "Book" SET "currentSnapshotId" = ${snapshotId}::uuid WHERE id = ${id}::uuid`;
    },

    async delete(id: string): Promise<void> {
      const book = await db.book.findUnique({ where: { id } });
      if (book?.filePath) {
        try {
          await unlink(book.filePath);
        } catch {
          // File may already be deleted, ignore
        }
      }
      await db.book.delete({ where: { id } });
    },

    async updateOwnedStatus(id: string, ownerId: string, status: string): Promise<Book | null> {
      const result = await db.book.updateMany({ where: { id, userId: ownerId }, data: { status } });
      if (result.count !== 1) return null;
      return db.book.findFirst({ where: { id, userId: ownerId } }) as Promise<Book | null>;
    },

    async deleteOwned(id: string, ownerId: string): Promise<boolean> {
      const book = await db.book.findFirst({ where: { id, userId: ownerId } });
      if (!book) return false;
      if (book.filePath) {
        try {
          await unlink(book.filePath);
        } catch {
          // 文件可能已被清理，数据库所有权删除仍应继续。
        }
      }
      const result = await db.book.deleteMany({ where: { id, userId: ownerId } });
      return result.count === 1;
    },
  };
}

export const BookRepository = createBookRepository(prisma);
