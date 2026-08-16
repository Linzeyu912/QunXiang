import { prisma } from './prisma.js';
import type { CharacterReview } from '@novel-agent/core';
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
