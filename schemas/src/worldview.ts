import { z } from 'zod';

/** 世界观/体系设定类别：世界观背景、力量体系、境界等级、组织势力、规则法则。 */
export const worldviewCategorySchema = z.enum(['worldview', 'power-system', 'realm', 'faction', 'rule']);

/**
 * 模型可能返回中文类别或变体写法，归一化到枚举值；无法识别时归为 worldview，
 * 避免单条非法类别导致整批提取结果校验失败。
 */
export function normalizeWorldviewCategory(value: unknown): z.infer<typeof worldviewCategorySchema> {
  const raw = typeof value === 'string' ? value.trim() : '';
  const parse = worldviewCategorySchema.safeParse(raw);
  if (parse.success) return parse.data;
  if (/力量|能量|体系|斗气|灵气|魂力|魔力/.test(raw)) return 'power-system';
  if (/境界|等级|段位|阶级/.test(raw)) return 'realm';
  if (/组织|势力|宗门|家族|帝国|学院|门派/.test(raw)) return 'faction';
  if (/规则|法则|禁忌|契约|限制/.test(raw)) return 'rule';
  return 'worldview';
}

/** 模型单次提取返回的世界观条目（与其他三类实体同一次调用产出）。 */
export const worldviewSchema = z.object({
  name: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  category: z.unknown().default('worldview').transform(normalizeWorldviewCategory),
  description: z.string().optional(),
  confidence: z.number().min(0).max(1).default(0.5),
  chapterRef: z.string().optional(),
  firstChapter: z.number().optional(),
  lastChapter: z.number().optional(),
  chapterAppearances: z.array(z.number()).default([]),
});

export const worldviewUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  aliases: z.array(z.string()).optional(),
  category: worldviewCategorySchema.optional(),
  description: z.string().optional(),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
});

export type WorldviewInput = z.infer<typeof worldviewSchema>;
export type WorldviewInputOutput = z.output<typeof worldviewSchema>;
export type WorldviewUpdateInput = z.infer<typeof worldviewUpdateSchema>;
