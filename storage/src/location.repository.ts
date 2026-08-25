import { prisma } from './prisma.js';
import type { Location } from '@qunxiang/core';
import type { PrismaClient } from '@prisma/client';
import { decodeJsonField, encodeJsonField } from './json-field.js';

export interface LocationRepository {
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
  }): Promise<Location>;
  createMany(locations: Array<{
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
  }>): Promise<number>;
  findByBookId(bookId: string): Promise<Location[]>;
  findByOwnedBookId(bookId: string, ownerId: string): Promise<Location[]>;
  /** 轻量计数：仅判空/统计用，避免全量拉取实体行。 */
  countByOwnedBookId(bookId: string, ownerId: string): Promise<number>;
  findById(id: string): Promise<Location | null>;
  findOwnedById(id: string, ownerId: string): Promise<Location | null>;
  findByStatus(bookId: string, status: string): Promise<Location[]>;
  findByOwnedStatus(bookId: string, ownerId: string, status: string): Promise<Location[]>;
  findByTier(bookId: string, tier: string): Promise<Location[]>;
  findByOwnedTier(bookId: string, ownerId: string, tier: string): Promise<Location[]>;
  update(id: string, data: Partial<Location>): Promise<Location>;
  updateOwned(id: string, ownerId: string, data: Partial<Location>): Promise<Location | null>;
  updateStatus(id: string, status: string): Promise<Location>;
  updateOwnedStatus(id: string, ownerId: string, status: string): Promise<Location | null>;
  deleteByBookId(bookId: string): Promise<void>;
}

function parseLocation(dbLoc: Record<string, unknown>): Location {
  return {
    ...dbLoc,
    aliases: decodeJsonField(dbLoc.aliases, []),
    chapterAppearances: decodeJsonField(dbLoc.chapterAppearances, []),
    tier: (dbLoc.tier as string) || 'candidate',
  } as unknown as Location;
}

export function createLocationRepository(db: PrismaClient): LocationRepository {
  return {
    async create(data) {
      const created = await db.location.create({
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
        },
      });
      return parseLocation(created);
    },

    async createMany(locations) {
      const result = await db.location.createMany({
        data: locations.map(l => ({
          bookId: l.bookId,
          name: l.name,
          aliases: encodeJsonField(l.aliases),
          description: l.description,
          confidence: l.confidence,
          chapterRef: l.chapterRef,
          importanceScore: l.importanceScore ?? 0,
          tier: l.tier ?? 'candidate',
          storyScore: l.storyScore ?? 0,
          productionScore: l.productionScore ?? 0,
          pillarCausal: l.pillarCausal ?? 0,
          pillarUniqueness: l.pillarUniqueness ?? 0,
          pillarTransition: l.pillarTransition ?? 0,
          mentionCount: l.mentionCount ?? 0,
          firstChapter: l.firstChapter,
          lastChapter: l.lastChapter,
          chapterAppearances: encodeJsonField(l.chapterAppearances || []),
        })),
      });
      return result.count;
    },

    async findByBookId(bookId: string) {
      const locs = await db.location.findMany({
        where: { bookId },
        orderBy: [{ importanceScore: 'desc' }, { id: 'asc' }],
      });
      return locs.map(l => parseLocation(l as unknown as Record<string, unknown>));
    },

    async findByOwnedBookId(bookId: string, ownerId: string) {
      const locs = await db.location.findMany({
        where: { bookId, book: { userId: ownerId } },
        orderBy: [{ importanceScore: 'desc' }, { id: 'asc' }],
      });
      return locs.map(l => parseLocation(l as unknown as Record<string, unknown>));
    },

    async countByOwnedBookId(bookId: string, ownerId: string) {
      return db.location.count({ where: { bookId, book: { userId: ownerId } } });
    },

    async findById(id: string) {
      const loc = await db.location.findUnique({ where: { id } });
      if (!loc) return null;
      return parseLocation(loc as unknown as Record<string, unknown>);
    },

    async findOwnedById(id: string, ownerId: string) {
      const loc = await db.location.findFirst({ where: { id, book: { userId: ownerId } } });
      return loc ? parseLocation(loc as unknown as Record<string, unknown>) : null;
    },

    async findByStatus(bookId: string, status: string) {
      const locs = await db.location.findMany({
        where: { bookId, status },
        orderBy: [{ importanceScore: 'desc' }, { id: 'asc' }],
      });
      return locs.map(l => parseLocation(l as unknown as Record<string, unknown>));
    },

    async findByOwnedStatus(bookId: string, ownerId: string, status: string) {
      const locs = await db.location.findMany({
        where: { bookId, status, book: { userId: ownerId } },
        orderBy: [{ importanceScore: 'desc' }, { id: 'asc' }],
      });
      return locs.map(l => parseLocation(l as unknown as Record<string, unknown>));
    },

    async findByTier(bookId: string, tier: string) {
      const locs = await db.location.findMany({
        where: { bookId, tier },
        orderBy: [{ importanceScore: 'desc' }, { id: 'asc' }],
      });
      return locs.map(l => parseLocation(l as unknown as Record<string, unknown>));
    },

    async findByOwnedTier(bookId: string, ownerId: string, tier: string) {
      const locs = await db.location.findMany({
        where: { bookId, tier, book: { userId: ownerId } },
        orderBy: [{ importanceScore: 'desc' }, { id: 'asc' }],
      });
      return locs.map(l => parseLocation(l as unknown as Record<string, unknown>));
    },

    async update(id: string, data: Partial<Location>) {
      const updateData: Record<string, unknown> = { ...data };
      if (data.aliases) {
        updateData.aliases = encodeJsonField(data.aliases);
      }
      if (data.chapterAppearances) {
        updateData.chapterAppearances = encodeJsonField(data.chapterAppearances);
      }
      const updated = await db.location.update({
        where: { id },
        data: updateData,
      });
      return parseLocation(updated as unknown as Record<string, unknown>);
    },

    async updateOwned(id: string, ownerId: string, data: Partial<Location>) {
      const updateData: Record<string, unknown> = { ...data };
      if (data.aliases) updateData.aliases = encodeJsonField(data.aliases);
      if (data.chapterAppearances) updateData.chapterAppearances = encodeJsonField(data.chapterAppearances);
      const result = await db.location.updateMany({ where: { id, book: { userId: ownerId } }, data: updateData });
      if (result.count !== 1) return null;
      const updated = await db.location.findFirst({ where: { id, book: { userId: ownerId } } });
      return updated ? parseLocation(updated as unknown as Record<string, unknown>) : null;
    },

    async updateStatus(id: string, status: string) {
      const updated = await db.location.update({
        where: { id },
        data: { status },
      });
      return parseLocation(updated as unknown as Record<string, unknown>);
    },

    async updateOwnedStatus(id: string, ownerId: string, status: string) {
      const result = await db.location.updateMany({ where: { id, book: { userId: ownerId } }, data: { status } });
      if (result.count !== 1) return null;
      const updated = await db.location.findFirst({ where: { id, book: { userId: ownerId } } });
      return updated ? parseLocation(updated as unknown as Record<string, unknown>) : null;
    },

    async deleteByBookId(bookId: string) {
      await db.location.deleteMany({ where: { bookId } });
    },
  };
}

export const LocationRepository = createLocationRepository(prisma);
