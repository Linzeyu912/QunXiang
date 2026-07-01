import { z } from 'zod';

export const characterSchema = z.object({
  name: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  description: z.string().optional(),
  confidence: z.number().min(0).max(1).default(0.5),
  chapterRef: z.string().optional(),

  // 新增字段：用于重要性评估
  firstChapter: z.number().optional(),
  lastChapter: z.number().optional(),
  chapterAppearances: z.array(z.number()).default([]),
  mentionCount: z.number().default(0),
  dialogueCount: z.number().default(0),
  coCharacters: z.array(z.string()).default([]),
});

export const characterCreateSchema = characterSchema.extend({
  bookId: z.string().uuid(),
});

export const characterUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  aliases: z.array(z.string()).optional(),
  description: z.string().optional(),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
});

// Use z.output to get the type with defaults applied
export type CharacterInput = z.infer<typeof characterSchema>;
export type CharacterInputOutput = z.output<typeof characterSchema>;
export type CharacterCreateInput = z.infer<typeof characterCreateSchema>;
export type CharacterCreateInputOutput = z.output<typeof characterCreateSchema>;
export type CharacterUpdateInput = z.infer<typeof characterUpdateSchema>;
