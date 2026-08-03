import { prisma } from './prisma.js';
import type { Item, Owner } from '@novel-agent/core';
import type { PrismaClient } from '@prisma/client';
import { decodeJsonField, encodeJsonField } from './json-field.js';

export interface ItemRepository {
  create(data: {
    bookId: string;
    name: string;
    aliases: string[];
    description?: string;
    confidence: number;
    chapterRef?: string;
    importanceScore?: number;
    tier?: string;
    storyScore?: number;
    productionScore?: number;
    pillarCausal?: number;
    pillarUniqueness?: number;
    pillarTransition?: number;
    mentionCount?: number;
    firstChapter?: number;
    lastChapter?: number;
    chapterAppearances?: number[];
    owners?: Owner[];
  }): Promise<Item>;
  createMany(items: Array<{
    bookId: string;
    name: string;
    aliases: string[];
    description?: string;
    confidence: number;
    chapterRef?: string;
    importanceScore?: number;
    tier?: string;
    storyScore?: number;
    productionScore?: number;
    pillarCausal?: number;
    pillarUniqueness?: number;
    pillarTransition?: number;
    mentionCount?: number;
    firstChapter?: number;
    lastChapter?: number;
    chapterAppearances?: number[];
    owners?: Owner[];
  }>): Promise<number>;
  findByBookId(bookId: string): Promise<Item[]>;
  findByOwnedBookId(bookId: string, ownerId: string): Promise<Item[]>;
  findById(id: string): Promise<Item | null>;
  findOwnedById(id: string, ownerId: string): Promise<Item | null>;
  findByStatus(bookId: string, status: string): Promise<Item[]>;
  findByOwnedStatus(bookId: string, ownerId: string, status: string): Promise<Item[]>;
  findByTier(bookId: string, tier: string): Promise<Item[]>;
  findByOwnedTier(bookId: string, ownerId: string, tier: string): Promise<Item[]>;
  update(id: string, data: Partial<Item>): Promise<Item>;
  updateOwned(id: string, ownerId: string, data: Partial<Item>): Promise<Item | null>;
  updateStatus(id: string, status: string): Promise<Item>;
  updateOwnedStatus(id: string, ownerId: string, status: string): Promise<Item | null>;
  deleteByBookId(bookId: string): Promise<void>;
}

function parseItem(dbItem: Record<string, unknown>): Item {
  return {
    ...dbItem,
    aliases: decodeJsonField(dbItem.aliases, []),
    chapterAppearances: decodeJsonField(dbItem.chapterAppearances, []),
    owners: decodeJsonField(dbItem.owners, []),
    tier: (dbItem.tier as string) || 'candidate',
  } as unknown as Item;
}

export function createItemRepository(db: PrismaClient): ItemRepository {
  return {
    async create(data) {
      const created = await db.item.create({
        data: {
          bookId: data.bookId,
          name: data.name,
          aliases: encodeJsonField(data.aliases),
          description: data.description,
          confidence: data.confidence,
          chapterRef: data.chapterRef,
          importanceScore: data.importanceScore ?? 0,
          tier: data.tier ?? 'candidate',
          storyScore: data.storyScore ?? 0,
          productionScore: data.productionScore ?? 0,
          pillarCausal: data.pillarCausal ?? 0,
          pillarUniqueness: data.pillarUniqueness ?? 0,
          pillarTransition: data.pillarTransition ?? 0,
          mentionCount: data.mentionCount ?? 0,
          firstChapter: data.firstChapter,
          lastChapter: data.lastChapter,
          chapterAppearances: encodeJsonField(data.chapterAppearances || []),
          owners: encodeJsonField(data.owners || []),
        },
      });
      return parseItem(created);
    },

    async createMany(items) {
      const result = await db.item.createMany({
        data: items.map(i => ({
          bookId: i.bookId,
          name: i.name,
          aliases: encodeJsonField(i.aliases),
          description: i.description,
          confidence: i.confidence,
          chapterRef: i.chapterRef,
          importanceScore: i.importanceScore ?? 0,
          tier: i.tier ?? 'candidate',
          storyScore: i.storyScore ?? 0,
          productionScore: i.productionScore ?? 0,
          pillarCausal: i.pillarCausal ?? 0,
          pillarUniqueness: i.pillarUniqueness ?? 0,
          pillarTransition: i.pillarTransition ?? 0,
          mentionCount: i.mentionCount ?? 0,
          firstChapter: i.firstChapter,
          lastChapter: i.lastChapter,
          chapterAppearances: encodeJsonField(i.chapterAppearances || []),
          owners: encodeJsonField(i.owners || []),
        })),
      });
      return result.count;
    },

    async findByBookId(bookId: string) {
      const items = await db.item.findMany({
        where: { bookId },
        orderBy: [{ importanceScore: 'desc' }, { id: 'asc' }],
      });
      return items.map(i => parseItem(i as unknown as Record<string, unknown>));
    },

    async findByOwnedBookId(bookId: string, ownerId: string) {
      const items = await db.item.findMany({
        where: { bookId, book: { userId: ownerId } },
        orderBy: [{ importanceScore: 'desc' }, { id: 'asc' }],
      });
      return items.map(i => parseItem(i as unknown as Record<string, unknown>));
    },

    async findById(id: string) {
      const item = await db.item.findUnique({ where: { id } });
      if (!item) return null;
      return parseItem(item as unknown as Record<string, unknown>);
    },

    async findOwnedById(id: string, ownerId: string) {
      const item = await db.item.findFirst({ where: { id, book: { userId: ownerId } } });
      return item ? parseItem(item as unknown as Record<string, unknown>) : null;
    },

    async findByStatus(bookId: string, status: string) {
      const items = await db.item.findMany({
        where: { bookId, status },
        orderBy: [{ importanceScore: 'desc' }, { id: 'asc' }],
      });
      return items.map(i => parseItem(i as unknown as Record<string, unknown>));
    },

    async findByOwnedStatus(bookId: string, ownerId: string, status: string) {
      const items = await db.item.findMany({
        where: { bookId, status, book: { userId: ownerId } },
        orderBy: [{ importanceScore: 'desc' }, { id: 'asc' }],
      });
      return items.map(i => parseItem(i as unknown as Record<string, unknown>));
    },

    async findByTier(bookId: string, tier: string) {
      const items = await db.item.findMany({
        where: { bookId, tier },
        orderBy: [{ importanceScore: 'desc' }, { id: 'asc' }],
      });
      return items.map(i => parseItem(i as unknown as Record<string, unknown>));
    },

    async findByOwnedTier(bookId: string, ownerId: string, tier: string) {
      const items = await db.item.findMany({
        where: { bookId, tier, book: { userId: ownerId } },
        orderBy: [{ importanceScore: 'desc' }, { id: 'asc' }],
      });
      return items.map(i => parseItem(i as unknown as Record<string, unknown>));
    },

    async update(id: string, data: Partial<Item>) {
      const updateData: Record<string, unknown> = { ...data };
      if (data.aliases) {
        updateData.aliases = encodeJsonField(data.aliases);
      }
      if (data.chapterAppearances) {
        updateData.chapterAppearances = encodeJsonField(data.chapterAppearances);
      }
      if (data.owners) {
        updateData.owners = encodeJsonField(data.owners);
      }
      const updated = await db.item.update({
        where: { id },
        data: updateData,
      });
      return parseItem(updated as unknown as Record<string, unknown>);
    },

    async updateOwned(id: string, ownerId: string, data: Partial<Item>) {
      const updateData: Record<string, unknown> = { ...data };
      if (data.aliases) updateData.aliases = encodeJsonField(data.aliases);
      if (data.chapterAppearances) updateData.chapterAppearances = encodeJsonField(data.chapterAppearances);
      if (data.owners) updateData.owners = encodeJsonField(data.owners);
      const result = await db.item.updateMany({ where: { id, book: { userId: ownerId } }, data: updateData });
      if (result.count !== 1) return null;
      const updated = await db.item.findFirst({ where: { id, book: { userId: ownerId } } });
      return updated ? parseItem(updated as unknown as Record<string, unknown>) : null;
    },

    async updateStatus(id: string, status: string) {
      const updated = await db.item.update({
        where: { id },
        data: { status },
      });
      return parseItem(updated as unknown as Record<string, unknown>);
    },

    async updateOwnedStatus(id: string, ownerId: string, status: string) {
      const result = await db.item.updateMany({ where: { id, book: { userId: ownerId } }, data: { status } });
      if (result.count !== 1) return null;
      const updated = await db.item.findFirst({ where: { id, book: { userId: ownerId } } });
      return updated ? parseItem(updated as unknown as Record<string, unknown>) : null;
    },

    async deleteByBookId(bookId: string) {
      await db.item.deleteMany({ where: { bookId } });
    },
  };
}

export const ItemRepository = createItemRepository(prisma);
