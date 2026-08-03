import { prisma } from './prisma.js';
import type { Character, Outfit } from '@novel-agent/core';
import type { PrismaClient } from '@prisma/client';
import { decodeJsonField, encodeJsonField } from './json-field.js';

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
    outfits?: Outfit[];
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
    outfits?: Outfit[];
  }>): Promise<number>;
  findByBookId(bookId: string): Promise<Character[]>;
  findByOwnedBookId(bookId: string, ownerId: string): Promise<Character[]>;
  findById(id: string): Promise<Character | null>;
  findOwnedById(id: string, ownerId: string): Promise<Character | null>;
  findByStatus(bookId: string, status: string): Promise<Character[]>;
  findByOwnedStatus(bookId: string, ownerId: string, status: string): Promise<Character[]>;
  update(id: string, data: Partial<Character>): Promise<Character>;
  updateOwned(id: string, ownerId: string, data: Partial<Character>): Promise<Character | null>;
  updateStatus(id: string, status: string): Promise<Character>;
  updateOwnedStatus(id: string, ownerId: string, status: string): Promise<Character | null>;
  deleteByBookId(bookId: string): Promise<void>;
}

function parseCharacter(dbChar: Record<string, unknown>): Character {
  return {
    ...dbChar,
    aliases: decodeJsonField(dbChar.aliases, []),
    chapterAppearances: decodeJsonField(dbChar.chapterAppearances, []),
    coCharacters: decodeJsonField(dbChar.coCharacters, []),
    outfits: decodeJsonField(dbChar.outfits, []),
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
      outfits?: Outfit[];
    }): Promise<Character> {
      const created = await db.character.create({
        data: {
          bookId: data.bookId,
          name: data.name,
          aliases: encodeJsonField(data.aliases),
          description: data.description,
          confidence: data.confidence,
          chapterRef: data.chapterRef,
          firstChapter: data.firstChapter,
          lastChapter: data.lastChapter,
          chapterAppearances: encodeJsonField(data.chapterAppearances || []),
          mentionCount: data.mentionCount || 0,
          dialogueCount: data.dialogueCount || 0,
          coCharacters: encodeJsonField(data.coCharacters || []),
          outfits: encodeJsonField(data.outfits || []),
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
      outfits?: Outfit[];
    }>): Promise<number> {
      const result = await db.character.createMany({
        data: characters.map(c => ({
          bookId: c.bookId,
          name: c.name,
          aliases: encodeJsonField(c.aliases),
          description: c.description,
          confidence: c.confidence,
          chapterRef: c.chapterRef,
          firstChapter: c.firstChapter,
          lastChapter: c.lastChapter,
          chapterAppearances: encodeJsonField(c.chapterAppearances || []),
          mentionCount: c.mentionCount || 0,
          dialogueCount: c.dialogueCount || 0,
          coCharacters: encodeJsonField(c.coCharacters || []),
          outfits: encodeJsonField(c.outfits || []),
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

    async findByOwnedBookId(bookId: string, ownerId: string): Promise<Character[]> {
      const chars = await db.character.findMany({
        where: { bookId, book: { userId: ownerId } },
        orderBy: { createdAt: 'asc' },
      });
      return chars.map(c => parseCharacter(c as unknown as Record<string, unknown>));
    },

    async findById(id: string): Promise<Character | null> {
      const char = await db.character.findUnique({ where: { id } });
      if (!char) return null;
      return parseCharacter(char as unknown as Record<string, unknown>);
    },

    async findOwnedById(id: string, ownerId: string): Promise<Character | null> {
      const char = await db.character.findFirst({ where: { id, book: { userId: ownerId } } });
      return char ? parseCharacter(char as unknown as Record<string, unknown>) : null;
    },

    async findByStatus(bookId: string, status: string): Promise<Character[]> {
      const chars = await db.character.findMany({
        where: { bookId, status },
        orderBy: { createdAt: 'asc' },
      });
      return chars.map(c => parseCharacter(c as unknown as Record<string, unknown>));
    },

    async findByOwnedStatus(bookId: string, ownerId: string, status: string): Promise<Character[]> {
      const chars = await db.character.findMany({
        where: { bookId, status, book: { userId: ownerId } },
        orderBy: { createdAt: 'asc' },
      });
      return chars.map(c => parseCharacter(c as unknown as Record<string, unknown>));
    },

    async update(id: string, data: Partial<Character>): Promise<Character> {
      const updateData: Record<string, unknown> = { ...data };
      if (data.aliases) {
        updateData.aliases = encodeJsonField(data.aliases);
      }
      if (data.chapterAppearances) {
        updateData.chapterAppearances = encodeJsonField(data.chapterAppearances);
      }
      if (data.coCharacters) {
        updateData.coCharacters = encodeJsonField(data.coCharacters);
      }
      if (data.outfits) {
        updateData.outfits = encodeJsonField(data.outfits);
      }
      const updated = await db.character.update({
        where: { id },
        data: updateData,
      });
      return parseCharacter(updated as unknown as Record<string, unknown>);
    },

    async updateOwned(id: string, ownerId: string, data: Partial<Character>): Promise<Character | null> {
      const existing = await db.character.findFirst({ where: { id, book: { userId: ownerId } } });
      if (!existing) return null;
      const updateData: Record<string, unknown> = { ...data };
      if (data.aliases) updateData.aliases = encodeJsonField(data.aliases);
      if (data.chapterAppearances) updateData.chapterAppearances = encodeJsonField(data.chapterAppearances);
      if (data.coCharacters) updateData.coCharacters = encodeJsonField(data.coCharacters);
      if (data.outfits) updateData.outfits = encodeJsonField(data.outfits);
      const result = await db.character.updateMany({ where: { id, book: { userId: ownerId } }, data: updateData });
      if (result.count !== 1) return null;
      const updated = await db.character.findFirst({ where: { id, book: { userId: ownerId } } });
      return updated ? parseCharacter(updated as unknown as Record<string, unknown>) : null;
    },

    async updateStatus(id: string, status: string): Promise<Character> {
      const updated = await db.character.update({
        where: { id },
        data: { status },
      });
      return parseCharacter(updated as unknown as Record<string, unknown>);
    },

    async updateOwnedStatus(id: string, ownerId: string, status: string): Promise<Character | null> {
      const result = await db.character.updateMany({ where: { id, book: { userId: ownerId } }, data: { status } });
      if (result.count !== 1) return null;
      const updated = await db.character.findFirst({ where: { id, book: { userId: ownerId } } });
      return updated ? parseCharacter(updated as unknown as Record<string, unknown>) : null;
    },

    async deleteByBookId(bookId: string): Promise<void> {
      await db.character.deleteMany({ where: { bookId } });
    },
  };
}

export const CharacterRepository = createCharacterRepository(prisma);
