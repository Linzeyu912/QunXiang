import { z } from 'zod';
export const characterSchema = z.object({
    name: z.string().min(1),
    aliases: z.array(z.string()).default([]),
    description: z.string().optional(),
    confidence: z.number().min(0).max(1).default(0.5),
    chapterRef: z.string().optional(),
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
//# sourceMappingURL=character.js.map