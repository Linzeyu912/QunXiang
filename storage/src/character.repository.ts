import { prisma } from './prisma.js';
import type { Character } from '@novel-agent/core';
import type { PrismaClient } from '@prisma/client';

export interface CharacterRepository {
  create(data: {
    bookId: string;
    name: string;
    aliases: string[];
    description?: string;
    confidence: number;
    chapterRef?: string;
    firstChapter?: number;
    lastChapter?: number;
    chapterAppearances?: number[];
    mentionCount?: number;
    dialogueCount?: number;
    coCharacters?: string[];
  }): Promise<Character>;
  createMany(characters: Array<{
    bookId: string;
    name: string;
    aliases: string[];
    description?: string;
    confidence: number;
    chapterRef?: string;
    firstChapter?: number;
    lastChapter?: number;
    chapterAppearances?: number[];
    mentionCount?: number;
    dialogueCount?: number;
    coCharacters?: string[];
  }>): Promise<number>;
  findByBookId(bookId: string): Promise<Character[]>;
  findById(id: string): Promise<Character | null>;
  findByStatus(bookId: string, status: string): Promise<Character[]>;
  update(id: string, data: Partial<Character>): Promise<Character>;
  updateStatus(id: string, status: string): Promise<Character>;
  deleteByBookId(bookId: string): Promise<void>;
}

function parseCharacter(dbChar: Record<string, unknown>): Character {
  return {
    ...dbChar,
    aliases: JSON.parse((dbChar.aliases as string) || '[]'),
    chapterAppearances: JSON.parse((dbChar.chapterAppearances as string) || '[]'),
    coCharacters: JSON.parse((dbChar.coCharacters as string) || '[]'),
  } as unknown as Character;
}

export function createCharacterRepository(db: PrismaClient): CharacterRepository {
  return {
    async create(data: {
      bookId: string;
      name: string;
      aliases: string[];
      description?: string;
      confidence: number;
      chapterRef?: string;
      firstChapter?: number;
      lastChapter?: number;
      chapterAppearances?: number[];
      mentionCount?: number;
      dialogueCount?: number;
      coCharacters?: string[];
    }): Promise<Character> {
      const created = await db.character.create({
        data: {
          bookId: data.bookId,
          name: data.name,
          aliases: JSON.stringify(data.aliases),
          description: data.description,
          confidence: data.confidence,
          chapterRef: data.chapterRef,
          firstChapter: data.firstChapter,
          lastChapter: data.lastChapter,
          chapterAppearances: JSON.stringify(data.chapterAppearances || []),
          mentionCount: data.mentionCount || 0,
          dialogueCount: data.dialogueCount || 0,
          coCharacters: JSON.stringify(data.coCharacters || []),
        },
      });
      return parseCharacter(created);
    },

    async createMany(characters: Array<{
      bookId: string;
      name: string;
      aliases: string[];
      description?: string;
      confidence: number;
      chapterRef?: string;
      firstChapter?: number;
      lastChapter?: number;
      chapterAppearances?: number[];
      mentionCount?: number;
      dialogueCount?: number;
      coCharacters?: string[];
    }>): Promise<number> {
      const result = await db.character.createMany({
        data: characters.map(c => ({
          bookId: c.bookId,
          name: c.name,
          aliases: JSON.stringify(c.aliases),
          description: c.description,
          confidence: c.confidence,
          chapterRef: c.chapterRef,
          firstChapter: c.firstChapter,
          lastChapter: c.lastChapter,
          chapterAppearances: JSON.stringify(c.chapterAppearances || []),
          mentionCount: c.mentionCount || 0,
          dialogueCount: c.dialogueCount || 0,
          coCharacters: JSON.stringify(c.coCharacters || []),
        })),
      });
      return result.count;
    },

    async findByBookId(bookId: string): Promise<Character[]> {
      const chars = await db.character.findMany({
        where: { bookId },
        orderBy: { createdAt: 'asc' },
      });
      return chars.map(c => parseCharacter(c as unknown as Record<string, unknown>));
    },

    async findById(id: string): Promise<Character | null> {
      const char = await db.character.findUnique({ where: { id } });
      if (!char) return null;
      return parseCharacter(char as unknown as Record<string, unknown>);
    },

    async findByStatus(bookId: string, status: string): Promise<Character[]> {
      const chars = await db.character.findMany({
        where: { bookId, status },
        orderBy: { createdAt: 'asc' },
      });
      return chars.map(c => parseCharacter(c as unknown as Record<string, unknown>));
    },

    async update(id: string, data: Partial<Character>): Promise<Character> {
      const updateData: Record<string, unknown> = { ...data };
      if (data.aliases) {
        updateData.aliases = JSON.stringify(data.aliases);
      }
      if (data.chapterAppearances) {
        updateData.chapterAppearances = JSON.stringify(data.chapterAppearances);
      }
      if (data.coCharacters) {
        updateData.coCharacters = JSON.stringify(data.coCharacters);
      }
      const updated = await db.character.update({
        where: { id },
        data: updateData,
      });
      return parseCharacter(updated as unknown as Record<string, unknown>);
    },

    async updateStatus(id: string, status: string): Promise<Character> {
      const updated = await db.character.update({
        where: { id },
        data: { status },
      });
      return parseCharacter(updated as unknown as Record<string, unknown>);
    },

    async deleteByBookId(bookId: string): Promise<void> {
      await db.character.deleteMany({ where: { bookId } });
    },
  };
}

export const CharacterRepository = createCharacterRepository(prisma);
