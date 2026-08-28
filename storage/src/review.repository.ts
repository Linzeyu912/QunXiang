import { prisma } from './prisma.js';
import type { CharacterReview } from '@qunxiang/core';
import type { PrismaClient } from '@prisma/client';

export interface ReviewRepository {
  create(data: {
    characterId: string;
    userId: string;
    action: string;
    previousValue?: string;
    newValue?: string;
  }): Promise<CharacterReview>;
  findByCharacterId(characterId: string): Promise<CharacterReview[]>;
  /** 批量按角色查询：单条 IN 查询替代逐角色 N+1，组内保持 createdAt DESC、id ASC。 */
  findByCharacterIds(characterIds: string[]): Promise<CharacterReview[]>;
  findOwnedByCharacterId(characterId: string, ownerId: string): Promise<CharacterReview[]>;
  findMergeRejectionsByOwnedBook(bookId: string, ownerId: string): Promise<CharacterReview[]>;
}

export function createReviewRepository(db: PrismaClient): ReviewRepository {
  return {
  async create(data: {
    characterId: string;
    userId: string;
    action: string;
    previousValue?: string;
    newValue?: string;
  }): Promise<CharacterReview> {
    return db.characterReview.create({ data }) as Promise<CharacterReview>;
  },

  async findByCharacterId(characterId: string): Promise<CharacterReview[]> {
    return db.characterReview.findMany({
      where: { characterId },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    }) as Promise<CharacterReview[]>;
  },

  async findByCharacterIds(characterIds: string[]): Promise<CharacterReview[]> {
    if (characterIds.length === 0) return [];
    // characterId 排序只为结果分组稳定；调用方按 characters 数组顺序重组，
    // 组内顺序与 findByCharacterId 一致（createdAt DESC、id ASC）。
    return db.characterReview.findMany({
      where: { characterId: { in: characterIds } },
      orderBy: [{ characterId: 'asc' }, { createdAt: 'desc' }, { id: 'asc' }],
    }) as Promise<CharacterReview[]>;
  },

  async findOwnedByCharacterId(characterId: string, ownerId: string): Promise<CharacterReview[]> {
    return db.characterReview.findMany({
      where: {
        characterId,
        userId: ownerId,
        character: { book: { userId: ownerId } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    }) as Promise<CharacterReview[]>;
  },

  async findMergeRejectionsByOwnedBook(bookId: string, ownerId: string): Promise<CharacterReview[]> {
    return db.characterReview.findMany({
      where: { action: 'MERGE_REJECTED', userId: ownerId, character: { bookId, book: { userId: ownerId } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    }) as Promise<CharacterReview[]>;
  },
  };
}

export const ReviewRepository = createReviewRepository(prisma);
