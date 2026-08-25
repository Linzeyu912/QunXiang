import { z } from 'zod';
import { characterSchema } from './character.js';
import { itemSchema } from './item.js';
import { locationSchema } from './location.js';
import { worldviewSchema } from './worldview.js';

/**
 * Combined extraction result for a single LLM call.
 * 模型在一个 JSON 对象中返回角色、道具、地点与世界观设定；worldviews
 * 允许缺失并默认空数组，兼容旧版提示词与模型输出。
 */
export const extractionResultSchema = z.object({
  characters: characterSchema.array(),
  items: itemSchema.array(),
  locations: locationSchema.array(),
  worldviews: worldviewSchema.array().default([]),
});

export type ExtractionResult = z.infer<typeof extractionResultSchema>;
