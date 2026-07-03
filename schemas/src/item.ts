import { z } from 'zod';

/**
 * 道具持有者。道具可易主（如 黑色古戒：母亲遗物 → 萧炎）。
 * name: 持有者称呼（按原文）；canonicalName: 经角色消解后的规范名（后端回填）。
 * firstChapter/lastChapter: 持有章节区间；note: 契机（如 "母亲遗物" "拍卖购得"）。
 */
export const ownerSchema = z.object({
  name: z.string().min(1),
  canonicalName: z.string().optional(),
  firstChapter: z.number().optional(),
  lastChapter: z.number().optional(),
  note: z.string().optional(),
});

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

  // 该道具的持有者（提取阶段结构化抓取，带章节区间；道具可易主）
  owners: z.array(ownerSchema).default([]),
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
