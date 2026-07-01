import { prisma } from './prisma.js';
import type { CharacterReview } from '@novel-agent/core';

export const ReviewRepository = {
  async create(data: {
    characterId: string;
    userId: string;
    action: string;
    previousValue?: string;
    newValue?: string;
  }): Promise<CharacterReview> {
    return prisma.characterReview.create({ data }) as Promise<CharacterReview>;
  },

  async findByCharacterId(characterId: string): Promise<CharacterReview[]> {
    return prisma.characterReview.findMany({
      where: { characterId },
      orderBy: { createdAt: 'desc' },
    }) as Promise<CharacterReview[]>;
  },
};
