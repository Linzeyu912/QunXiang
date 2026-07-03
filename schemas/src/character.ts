import { z } from 'zod';

/**
 * 一套显著服饰/装扮。一个角色在不同场景/章节可有多套。
 * scene: 场景/用途标签（如 "日常" "伪装炼药师" "战斗" "礼服"）。
 * firstChapter/lastChapter: 该套出现的章节区间（1 基）。
 */
export const outfitSchema = z.object({
  description: z.string().min(1),
  scene: z.string().optional(),
  firstChapter: z.number().optional(),
  lastChapter: z.number().optional(),
});

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

  // 该角色的所有显著服饰套系（提取阶段结构化抓取，带章节区间）
  outfits: z.array(outfitSchema).default([]),
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
