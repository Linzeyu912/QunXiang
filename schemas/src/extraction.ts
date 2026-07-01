import { z } from 'zod';
import { characterSchema } from './character.js';
import { itemSchema } from './item.js';
import { locationSchema } from './location.js';

/**
 * Combined extraction result for a single LLM call.
 * The model returns characters, items, and locations in one JSON object;
 * importance/tier fields default here and are recomputed downstream by
 * calcImportance.
 */
export const extractionResultSchema = z.object({
  characters: characterSchema.array(),
  items: itemSchema.array(),
  locations: locationSchema.array(),
});

export type ExtractionResult = z.infer<typeof extractionResultSchema>;
