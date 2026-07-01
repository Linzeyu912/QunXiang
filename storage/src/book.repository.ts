import { prisma } from './prisma.js';
import type { Book } from '@novel-agent/core';
import type { PrismaClient } from '@prisma/client';
import { unlink } from 'fs/promises';

export interface BookRepository {
  create(data: { title: string; filePath: string; fileSize: number; mimeType: string; userId: string }): Promise<Book>;
  findById(id: string): Promise<Book | null>;
  findAll(userId: string): Promise<Book[]>;
  updateStatus(id: string, status: string): Promise<Book>;
  delete(id: string): Promise<void>;
}

export function createBookRepository(db: PrismaClient): BookRepository {
  return {
    async create(data: { title: string; filePath: string; fileSize: number; mimeType: string; userId: string }): Promise<Book> {
      return db.book.create({ data }) as Promise<Book>;
    },

    async findById(id: string): Promise<Book | null> {
      return db.book.findUnique({ where: { id } }) as Promise<Book | null>;
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
  };
}

export const BookRepository = createBookRepository(prisma);
