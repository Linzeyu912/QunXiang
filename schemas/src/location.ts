import { z } from 'zod';

export const locationSchema = z.object({
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

export const locationCreateSchema = locationSchema.extend({
  bookId: z.string().uuid(),
});

export const locationUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  aliases: z.array(z.string()).optional(),
  description: z.string().optional(),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
});

export type LocationInput = z.infer<typeof locationSchema>;
export type LocationInputOutput = z.output<typeof locationSchema>;
export type LocationCreateInput = z.infer<typeof locationCreateSchema>;
export type LocationCreateInputOutput = z.output<typeof locationCreateSchema>;
export type LocationUpdateInput = z.infer<typeof locationUpdateSchema>;
