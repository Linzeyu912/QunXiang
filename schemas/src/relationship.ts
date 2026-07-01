import { z } from 'zod';

export const RelationshipTypeSchema = z.enum([
  'family',
  'romantic',
  'friendship',
  'antagonistic',
  'professional',
  'narrative',
  'unknown',
]);

export const RelationshipEvidenceSchema = z.object({
  text: z.string(),
  chapter: z.number(),
  sentence: z.string(),
});

export const RelationshipSchema = z.object({
  subject: z.string(),
  object: z.string(),
  type: RelationshipTypeSchema,
  confidence: z.number().min(0).max(1),
  evidence: z.array(RelationshipEvidenceSchema).default([]),
  chapterFirst: z.number().optional(),
  chapterLast: z.number().optional(),
});

export type RelationshipType = z.infer<typeof RelationshipTypeSchema>;
export type RelationshipEvidence = z.infer<typeof RelationshipEvidenceSchema>;
export type Relationship = z.infer<typeof RelationshipSchema>;

export const CharacterWithRelationsSchema = z.object({
  name: z.string(),
  aliases: z.array(z.string()).default([]),
  description: z.string().optional(),
  confidence: z.number().min(0).max(1),
  status: z.string(),
  chapterRef: z.string().optional(),
  firstChapter: z.number().optional(),
  lastChapter: z.number().optional(),
  chapterAppearances: z.array(z.number()).default([]),
  mentionCount: z.number().default(0),
  dialogueCount: z.number().default(0),
  coCharacters: z.array(z.string()).default([]),
  relationships: z.array(RelationshipSchema).default([]),
});
