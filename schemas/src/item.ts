import { z } from 'zod';

export const itemSchema = z.object({
  name: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  description: z.string().optional(),
  confidence: z.number().min(0).max(1).default(0.5),
  chapterRef: z.string().optional(),

  // 重要性评估字段
  importanceScore: z.number().default(0),
  tier: z.enum(['core', 'supporting', 'candidate', 'archived']).default('candidate'),
  storyScore: z.number().int().default(0),
  productionScore: z.number().default(0),
  pillarCausal: z.number().int().default(0),
  pillarUniqueness: z.number().int().default(0),
  pillarTransition: z.number().int().default(0),
  mentionCount: z.number().int().default(0),
  firstChapter: z.number().optional(),
  lastChapter: z.number().optional(),
  chapterAppearances: z.array(z.number()).default([]),
});

export const itemCreateSchema = itemSchema.extend({
  bookId: z.string().uuid(),
});

export const itemUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  aliases: z.array(z.string()).optional(),
  description: z.string().optional(),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
});

export type ItemInput = z.infer<typeof itemSchema>;
export type ItemInputOutput = z.output<typeof itemSchema>;
export type ItemCreateInput = z.infer<typeof itemCreateSchema>;
export type ItemCreateInputOutput = z.output<typeof itemCreateSchema>;
export type ItemUpdateInput = z.infer<typeof itemUpdateSchema>;
