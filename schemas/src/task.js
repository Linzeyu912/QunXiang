import { z } from 'zod';
export const taskSchema = z.object({
    bookId: z.string().uuid(),
    agentType: z.enum(['extractor', 'validator', 'entity-resolution', 'reviewer']),
    payload: z.unknown().default({}),
    status: z.enum(['pending', 'running', 'completed', 'failed']).default('pending'),
});
export const taskCreateSchema = taskSchema;
//# sourceMappingURL=task.js.map