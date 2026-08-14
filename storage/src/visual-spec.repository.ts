import { prisma } from './prisma.js';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { VisualSpec, VisualSpecEntityType, VisualSpecStatus } from '@novel-agent/core';
import { encodeJsonField } from './json-field.js';

export interface CreateVisualSpecData {
  bookId: string;
  entityType: VisualSpecEntityType;
  entityName: string;
  variantKey: string;
  version: number;
  status?: VisualSpecStatus;
  prompt: string;
  promptSource: string;
  quality?: string | null;
  styleTags?: string[];
  model?: string | null;
  primaryImageId?: string | null;
  sourceChapters?: string | null;
  payload?: Record<string, unknown>;
}

export interface VisualSpecRepository {
  supersedeActive(bookId: string, entityType?: string, entityName?: string): Promise<number>;
  createMany(rows: CreateVisualSpecData[]): Promise<number>;
  maxVersion(bookId: string, entityType: string, entityName: string, variantKey: string): Promise<number>;
  maxVersionsForBook(bookId: string): Promise<Map<string, number>>;
  findActive(bookId: string, entityType: string, entityName: string, variantKey: string): Promise<VisualSpec | null>;
  findActiveByEntity(bookId: string, entityType: string, entityName: string): Promise<VisualSpec[]>;
  findOwnedActiveByEntity(
    bookId: string,
    ownerId: string,
    entityType: string,
    entityName: string,
  ): Promise<VisualSpec[]>;
  setPrimaryImage(specId: string, imageId: string): Promise<VisualSpec | null>;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function asPayload(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function parseSpec(row: {
  id: string;
  bookId: string;
  entityType: string;
  entityName: string;
  variantKey: string;
  version: number;
  status: string;
  prompt: string;
  promptSource: string;
  quality: string | null;
  styleTags: Prisma.JsonValue;
  model: string | null;
  primaryImageId: string | null;
  sourceChapters: string | null;
  payload: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
}): VisualSpec {
  return {
    id: row.id,
    bookId: row.bookId,
    entityType: row.entityType as VisualSpecEntityType,
    entityName: row.entityName,
    variantKey: row.variantKey,
    version: row.version,
    status: row.status as VisualSpecStatus,
    prompt: row.prompt,
    promptSource: row.promptSource,
    quality: row.quality,
    styleTags: asStringArray(row.styleTags),
    model: row.model,
    primaryImageId: row.primaryImageId,
    sourceChapters: row.sourceChapters,
    payload: asPayload(row.payload),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createVisualSpecRepository(db: PrismaClient): VisualSpecRepository {
  return {
    async supersedeActive(bookId, entityType, entityName): Promise<number> {
      const result = await db.visualSpec.updateMany({
        where: {
          bookId,
          status: 'ACTIVE',
          ...(entityType ? { entityType } : {}),
          ...(entityName ? { entityName } : {}),
        },
        data: { status: 'SUPERSEDED' },
      });
      return result.count;
    },

    async createMany(rows): Promise<number> {
      if (rows.length === 0) return 0;
      const result = await db.visualSpec.createMany({
        data: rows.map((row) => ({
          bookId: row.bookId,
          entityType: row.entityType,
          entityName: row.entityName,
          variantKey: row.variantKey,
          version: row.version,
          status: row.status ?? 'ACTIVE',
          prompt: row.prompt,
          promptSource: row.promptSource,
          quality: row.quality ?? null,
          styleTags: encodeJsonField(row.styleTags ?? []),
          model: row.model ?? null,
          primaryImageId: row.primaryImageId ?? null,
          sourceChapters: row.sourceChapters ?? null,
          payload: encodeJsonField(row.payload ?? {}),
        })),
      });
      return result.count;
    },

    async maxVersion(bookId, entityType, entityName, variantKey): Promise<number> {
      const row = await db.visualSpec.aggregate({
        where: { bookId, entityType, entityName, variantKey },
        _max: { version: true },
      });
      return row._max.version ?? 0;
    },

    async maxVersionsForBook(bookId): Promise<Map<string, number>> {
      const rows = await db.visualSpec.groupBy({
        by: ['entityType', 'entityName', 'variantKey'],
        where: { bookId },
        _max: { version: true },
      });
      const map = new Map<string, number>();
      for (const row of rows) {
        map.set(`${row.entityType}\0${row.entityName}\0${row.variantKey}`, row._max.version ?? 0);
      }
      return map;
    },

    async findActive(bookId, entityType, entityName, variantKey): Promise<VisualSpec | null> {
      const row = await db.visualSpec.findFirst({
        where: { bookId, entityType, entityName, variantKey, status: 'ACTIVE' },
        orderBy: { version: 'desc' },
      });
      return row ? parseSpec(row) : null;
    },

    async findActiveByEntity(bookId, entityType, entityName): Promise<VisualSpec[]> {
      const rows = await db.visualSpec.findMany({
        where: { bookId, entityType, entityName, status: 'ACTIVE' },
        orderBy: [{ variantKey: 'asc' }, { version: 'desc' }],
      });
      return rows.map(parseSpec);
    },

    async findOwnedActiveByEntity(bookId, ownerId, entityType, entityName): Promise<VisualSpec[]> {
      const rows = await db.visualSpec.findMany({
        where: { bookId, entityType, entityName, status: 'ACTIVE', book: { userId: ownerId } },
        orderBy: [{ variantKey: 'asc' }, { version: 'desc' }],
      });
      return rows.map(parseSpec);
    },

    async setPrimaryImage(specId, imageId): Promise<VisualSpec | null> {
      const existing = await db.visualSpec.findUnique({ where: { id: specId } });
      if (!existing) return null;
      const row = await db.visualSpec.update({
        where: { id: specId },
        data: { primaryImageId: imageId },
      });
      return parseSpec(row);
    },
  };
}

export const VisualSpecRepository = createVisualSpecRepository(prisma);
