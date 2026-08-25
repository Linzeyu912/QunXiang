import { z } from 'zod';

/** 世界观体系梳理结果——模型对全文的结构化总结。 */
export const worldviewSynthesisSchema = z.object({
  /** 世界观总览——世界面貌、核心设定、时代背景、主要矛盾 */
  overview: z.string().nullable(),
  /** 修炼体系（力量体系 + 境界等级合并） */
  cultivationSystem: z.object({
    /** 体系总结——这个世界的力量是什么，如何运作 */
    summary: z.string(),
    /** 详细说明——修炼方式、能量来源、使用规则等 */
    details: z.string().nullable().optional(),
    /** 等级/境界/功法列表（从低到高或从基础到高深） */
    levels: z.array(z.object({
      name: z.string(),
      /** 总层数（如「九层」，仅功法类有） */
      totalLevels: z.string().nullable().optional(),
      description: z.string(),
    })).default([]),
  }).nullable(),
  /** 组织势力 */
  factions: z.object({
    summary: z.string(),
    groups: z.array(z.object({
      name: z.string(),
      description: z.string(),
      relation: z.string().nullable().optional(),
    })).default([]),
  }).nullable(),
  /** 规则/法则 */
  rules: z.object({
    summary: z.string(),
    items: z.array(z.string()).default([]),
  }).nullable(),
  /** 地理格局 */
  geography: z.object({
    summary: z.string(),
    regions: z.array(z.object({
      name: z.string(),
      description: z.string(),
    })).default([]),
  }).nullable(),
  /** 历史背景 */
  history: z.string().nullable(),
});

export type WorldviewSynthesis = z.infer<typeof worldviewSynthesisSchema>;
