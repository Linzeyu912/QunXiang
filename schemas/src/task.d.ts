import { z } from 'zod';
export declare const taskSchema: z.ZodObject<{
    bookId: z.ZodString;
    agentType: z.ZodEnum<["extractor", "validator", "entity-resolution", "reviewer"]>;
    payload: z.ZodDefault<z.ZodUnknown>;
    status: z.ZodDefault<z.ZodEnum<["pending", "running", "completed", "failed"]>>;
}, "strip", z.ZodTypeAny, {
    status: "pending" | "running" | "completed" | "failed";
    bookId: string;
    agentType: "extractor" | "validator" | "entity-resolution" | "reviewer";
    payload?: unknown;
}, {
    bookId: string;
    agentType: "extractor" | "validator" | "entity-resolution" | "reviewer";
    status?: "pending" | "running" | "completed" | "failed" | undefined;
    payload?: unknown;
}>;
export declare const taskCreateSchema: z.ZodObject<{
    bookId: z.ZodString;
    agentType: z.ZodEnum<["extractor", "validator", "entity-resolution", "reviewer"]>;
    payload: z.ZodDefault<z.ZodUnknown>;
    status: z.ZodDefault<z.ZodEnum<["pending", "running", "completed", "failed"]>>;
}, "strip", z.ZodTypeAny, {
    status: "pending" | "running" | "completed" | "failed";
    bookId: string;
    agentType: "extractor" | "validator" | "entity-resolution" | "reviewer";
    payload?: unknown;
}, {
    bookId: string;
    agentType: "extractor" | "validator" | "entity-resolution" | "reviewer";
    status?: "pending" | "running" | "completed" | "failed" | undefined;
    payload?: unknown;
}>;
export type TaskInput = z.infer<typeof taskSchema>;
export type TaskCreateInput = z.infer<typeof taskCreateSchema>;
//# sourceMappingURL=task.d.ts.map