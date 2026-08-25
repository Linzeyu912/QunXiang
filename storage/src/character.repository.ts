import { prisma } from './prisma.js';
import type { Character, Outfit } from '@qunxiang/core';
import type { Prisma, PrismaClient } from '@prisma/client';
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
    ageStages?: string[];
    primaryAgeStage?: string;
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
    ageStages?: string[];
    primaryAgeStage?: string;
  }>): Promise<number>;
  findByBookId(bookId: string): Promise<Character[]>;
  findByOwnedBookId(bookId: string, ownerId: string): Promise<Character[]>;
  /** 轻量计数：仅判空/统计用，避免全量拉取实体行。 */
  countByOwnedBookId(bookId: string, ownerId: string): Promise<number>;
  findById(id: string): Promise<Character | null>;
  findOwnedById(id: string, ownerId: string): Promise<Character | null>;
  findByStatus(bookId: string, status: string): Promise<Character[]>;
  findByOwnedStatus(bookId: string, ownerId: string, status: string): Promise<Character[]>;
  update(id: string, data: Partial<Character>): Promise<Character>;
  updateOwned(id: string, ownerId: string, data: Partial<Character>): Promise<Character | null>;
  updateStatus(id: string, status: string): Promise<Character>;
  updateOwnedStatus(id: string, ownerId: string, status: string): Promise<Character | null>;
  mergeOwned(primaryId: string, secondaryId: string, ownerId: string, reviewerId: string): Promise<Character | null>;
  rejectMergeOwned(primaryId: string, secondaryId: string, ownerId: string, reviewerId: string): Promise<boolean>;
  deleteByBookId(bookId: string): Promise<void>;
}

async function lockCharacterPair(
  tx: Prisma.TransactionClient,
  primaryId: string,
  secondaryId: string
): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "Character"
    WHERE "id" IN (${primaryId}::uuid, ${secondaryId}::uuid)
    ORDER BY "id" FOR UPDATE
  `;
  return rows.length === 2;
}

async function hasMergeRejection(
  tx: Prisma.TransactionClient,
  primaryId: string,
  secondaryId: string,
  reviewerId: string
): Promise<boolean> {
  return Boolean(await tx.characterReview.findFirst({
    where: {
      action: 'MERGE_REJECTED',
      userId: reviewerId,
      OR: [
        { characterId: primaryId, newValue: secondaryId },
        { characterId: secondaryId, newValue: primaryId },
      ],
    },
    select: { id: true },
  }));
}

function parseCharacter(dbChar: Record<string, unknown>): Character {
  return {
    ...dbChar,
    aliases: decodeJsonField(dbChar.aliases, []),
    chapterAppearances: decodeJsonField(dbChar.chapterAppearances, []),
    coCharacters: decodeJsonField(dbChar.coCharacters, []),
    outfits: decodeJsonField(dbChar.outfits, []),
    ageStages: decodeJsonField(dbChar.ageStages, []),
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
      ageStages?: string[];
      primaryAgeStage?: string;
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
          ageStages: encodeJsonField(data.ageStages || []),
          primaryAgeStage: data.primaryAgeStage,
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
      ageStages?: string[];
      primaryAgeStage?: string;
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
          ageStages: encodeJsonField(c.ageStages || []),
          primaryAgeStage: c.primaryAgeStage,
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

    async countByOwnedBookId(bookId: string, ownerId: string): Promise<number> {
      return db.character.count({ where: { bookId, book: { userId: ownerId } } });
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
      if (data.ageStages) {
        updateData.ageStages = encodeJsonField(data.ageStages);
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
      if (data.ageStages) updateData.ageStages = encodeJsonField(data.ageStages);
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

    async mergeOwned(primaryId: string, secondaryId: string, ownerId: string, reviewerId: string): Promise<Character | null> {
      if (primaryId === secondaryId) return null;
      return db.$transaction(async (tx) => {
        if (!(await lockCharacterPair(tx, primaryId, secondaryId))) return null;
        const [primary, secondary] = await Promise.all([
          tx.character.findFirst({ where: { id: primaryId, book: { userId: ownerId } } }),
          tx.character.findFirst({ where: { id: secondaryId, book: { userId: ownerId } } }),
        ]);
        if (!primary || !secondary || primary.bookId !== secondary.bookId) return null;
        if (await hasMergeRejection(tx, primary.id, secondary.id, reviewerId)) return null;
        const aliases = [...new Set([...decodeJsonField<string[]>(primary.aliases, []), ...decodeJsonField<string[]>(secondary.aliases, []), secondary.name])]
          .filter((alias) => alias.trim().toLowerCase() !== primary.name.trim().toLowerCase());
        const mergedIdentityNames = new Set([primary.name, ...aliases].map((name) => name.trim().toLowerCase()));
        const coCharacters = [...new Set([
          ...decodeJsonField<string[]>(primary.coCharacters, []),
          ...decodeJsonField<string[]>(secondary.coCharacters, []),
        ])].filter((name) => !mergedIdentityNames.has(name.trim().toLowerCase()));
        const chapters = [...new Set([...decodeJsonField<number[]>(primary.chapterAppearances, []), ...decodeJsonField<number[]>(secondary.chapterAppearances, [])])].sort((a, b) => a - b);
        const firstChapters = [primary.firstChapter, secondary.firstChapter].filter(
          (chapter): chapter is number => chapter != null
        );
        const lastChapters = [primary.lastChapter, secondary.lastChapter].filter(
          (chapter): chapter is number => chapter != null
        );
        const updated = await tx.character.update({ where: { id: primary.id }, data: {
          aliases: encodeJsonField(aliases),
          description: [primary.description, secondary.description].filter(Boolean).join('; ') || null,
          confidence: Math.max(primary.confidence, secondary.confidence),
          // A merge is identity review, not content-status review: retain the
          // surviving primary status and preserve the first available chapter reference.
          chapterRef: primary.chapterRef ?? secondary.chapterRef,
          firstChapter: [...firstChapters, ...chapters].length > 0
            ? Math.min(...firstChapters, ...chapters)
            : null,
          lastChapter: [...lastChapters, ...chapters].length > 0
            ? Math.max(...lastChapters, ...chapters)
            : null,
          chapterAppearances: encodeJsonField(chapters),
          mentionCount: primary.mentionCount + secondary.mentionCount,
          dialogueCount: primary.dialogueCount + secondary.dialogueCount,
          coCharacters: encodeJsonField(coCharacters),
          outfits: encodeJsonField([...decodeJsonField(primary.outfits, []), ...decodeJsonField(secondary.outfits, [])]),
          ageStages: encodeJsonField([...new Set([...decodeJsonField<string[]>(primary.ageStages, []), ...decodeJsonField<string[]>(secondary.ageStages, [])])]),
          primaryAgeStage: primary.primaryAgeStage ?? secondary.primaryAgeStage,
        } });
        // Keep the audit attached to the surviving record so the secondary
        // record's cascade deletion cannot erase the accepted-merge history.
        await tx.characterReview.create({
          data: {
            characterId: primary.id,
            userId: reviewerId,
            action: 'MERGE_ACCEPTED',
            previousValue: secondary.id,
            newValue: JSON.stringify({ primaryId: primary.id, secondaryId: secondary.id }),
          },
        });
        // The relation cascades on delete, so preserve the secondary's prior
        // review history by attaching it to the surviving character first.
        await tx.characterReview.updateMany({
          where: { characterId: secondary.id },
          data: { characterId: primary.id },
        });
        await tx.character.delete({ where: { id: secondary.id } });
        return parseCharacter(updated as unknown as Record<string, unknown>);
      });
    },

    async rejectMergeOwned(primaryId: string, secondaryId: string, ownerId: string, reviewerId: string): Promise<boolean> {
      if (primaryId === secondaryId) return false;
      return db.$transaction(async (tx) => {
        if (!(await lockCharacterPair(tx, primaryId, secondaryId))) return false;
        const [primary, secondary] = await Promise.all([
          tx.character.findFirst({ where: { id: primaryId, book: { userId: ownerId } } }),
          tx.character.findFirst({ where: { id: secondaryId, book: { userId: ownerId } } }),
        ]);
        if (!primary || !secondary || primary.bookId !== secondary.bookId) return false;
        if (await hasMergeRejection(tx, primary.id, secondary.id, reviewerId)) return false;
        await tx.characterReview.createMany({
          data: [
            { characterId: primary.id, userId: reviewerId, action: 'MERGE_REJECTED', newValue: secondary.id },
            { characterId: secondary.id, userId: reviewerId, action: 'MERGE_REJECTED', newValue: primary.id },
          ],
        });
        return true;
      });
    },

    async deleteByBookId(bookId: string): Promise<void> {
      await db.character.deleteMany({ where: { bookId } });
    },
  };
}

export const CharacterRepository = createCharacterRepository(prisma);
