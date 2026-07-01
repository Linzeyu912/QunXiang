import { prisma } from './prisma.js';
import type { Location } from '@novel-agent/core';
import type { PrismaClient } from '@prisma/client';

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
  findById(id: string): Promise<Location | null>;
  findByStatus(bookId: string, status: string): Promise<Location[]>;
  findByTier(bookId: string, tier: string): Promise<Location[]>;
  update(id: string, data: Partial<Location>): Promise<Location>;
  updateStatus(id: string, status: string): Promise<Location>;
  deleteByBookId(bookId: string): Promise<void>;
}

function parseLocation(dbLoc: Record<string, unknown>): Location {
  return {
    ...dbLoc,
    aliases: JSON.parse((dbLoc.aliases as string) || '[]'),
    chapterAppearances: JSON.parse((dbLoc.chapterAppearances as string) || '[]'),
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
          aliases: JSON.stringify(data.aliases),
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
          chapterAppearances: JSON.stringify(data.chapterAppearances || []),
        },
      });
      return parseLocation(created);
    },

    async createMany(locations) {
      const result = await db.location.createMany({
        data: locations.map(l => ({
          bookId: l.bookId,
          name: l.name,
          aliases: JSON.stringify(l.aliases),
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
          chapterAppearances: JSON.stringify(l.chapterAppearances || []),
        })),
      });
      return result.count;
    },

    async findByBookId(bookId: string) {
      const locs = await db.location.findMany({
        where: { bookId },
        orderBy: { importanceScore: 'desc' },
      });
      return locs.map(l => parseLocation(l as unknown as Record<string, unknown>));
    },

    async findById(id: string) {
      const loc = await db.location.findUnique({ where: { id } });
      if (!loc) return null;
      return parseLocation(loc as unknown as Record<string, unknown>);
    },

    async findByStatus(bookId: string, status: string) {
      const locs = await db.location.findMany({
        where: { bookId, status },
        orderBy: { importanceScore: 'desc' },
      });
      return locs.map(l => parseLocation(l as unknown as Record<string, unknown>));
    },

    async findByTier(bookId: string, tier: string) {
      const locs = await db.location.findMany({
        where: { bookId, tier },
        orderBy: { importanceScore: 'desc' },
      });
      return locs.map(l => parseLocation(l as unknown as Record<string, unknown>));
    },

    async update(id: string, data: Partial<Location>) {
      const updateData: Record<string, unknown> = { ...data };
      if (data.aliases) {
        updateData.aliases = JSON.stringify(data.aliases);
      }
      if (data.chapterAppearances) {
        updateData.chapterAppearances = JSON.stringify(data.chapterAppearances);
      }
      const updated = await db.location.update({
        where: { id },
        data: updateData,
      });
      return parseLocation(updated as unknown as Record<string, unknown>);
    },

    async updateStatus(id: string, status: string) {
      const updated = await db.location.update({
        where: { id },
        data: { status },
      });
      return parseLocation(updated as unknown as Record<string, unknown>);
    },

    async deleteByBookId(bookId: string) {
      await db.location.deleteMany({ where: { bookId } });
    },
  };
}

export const LocationRepository = createLocationRepository(prisma);
