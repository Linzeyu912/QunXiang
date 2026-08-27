import { prisma } from './prisma.js';
import type { PrismaClient } from '@prisma/client';

/** 统一审核记录入参：before/after 为可 JSON 化的实体快照片段。 */
export interface CreateEntityReviewInput {
  bookId: string;
  entityType: 'character' | 'location' | 'item' | 'worldview';
  entityId: string;
  entityName: string;
  actorId?: string | null;
  actorType?: 'USER' | 'SYSTEM' | 'IMPORT';
  action:
    | 'CREATE'
    | 'EDIT'
    | 'APPROVE'
    | 'REJECT'
    | 'RESTORE_FIELD'
    | 'AI_REFRESH'
    | 'MERGE_SUGGESTED'
    | 'MERGE_ACCEPTED'
    | 'MERGE_REJECTED'
    | 'ARCHIVE';
  beforeValue?: unknown;
  afterValue?: unknown;
  changedFields?: string[];
  reason?: string | null;
}

export interface EntityReviewRepository {
  create(input: CreateEntityReviewInput): Promise<{ id: string }>;
  createMany(inputs: CreateEntityReviewInput[]): Promise<number>;
  findByEntity(bookId: string, entityType: string, entityId: string): Promise<Array<Record<string, unknown>>>;
  findByBook(bookId: string, limit?: number): Promise<Array<Record<string, unknown>>>;
}

function toDbData(input: CreateEntityReviewInput) {
  return {
    bookId: input.bookId,
    entityType: input.entityType,
    entityId: input.entityId,
    entityName: input.entityName,
    actorId: input.actorId ?? null,
    actorType: input.actorType ?? 'USER',
    action: input.action,
    beforeValue: input.beforeValue === undefined ? undefined : (input.beforeValue as object),
    afterValue: input.afterValue === undefined ? undefined : (input.afterValue as object),
    changedFields: input.changedFields ?? [],
    reason: input.reason ?? null,
  };
}

export function createEntityReviewRepository(db: PrismaClient): EntityReviewRepository {
  return {
    async create(input: CreateEntityReviewInput) {
      const row = await db.entityReview.create({ data: toDbData(input), select: { id: true } });
      return row;
    },
    async createMany(inputs: CreateEntityReviewInput[]) {
      if (inputs.length === 0) return 0;
      const result = await db.entityReview.createMany({ data: inputs.map(toDbData) });
      return result.count;
    },
    async findByEntity(bookId: string, entityType: string, entityId: string) {
      return db.entityReview.findMany({
        where: { bookId, entityType, entityId },
        orderBy: { createdAt: 'desc' },
      }) as Promise<Array<Record<string, unknown>>>;
    },
    async findByBook(bookId: string, limit = 200) {
      return db.entityReview.findMany({
        where: { bookId },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }) as Promise<Array<Record<string, unknown>>>;
    },
  };
}

export const EntityReviewRepository = createEntityReviewRepository(prisma);
