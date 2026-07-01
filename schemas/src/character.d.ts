import { z } from 'zod';
export declare const characterSchema: z.ZodObject<{
    name: z.ZodString;
    aliases: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    description: z.ZodOptional<z.ZodString>;
    confidence: z.ZodDefault<z.ZodNumber>;
    chapterRef: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    name: string;
    aliases: string[];
    confidence: number;
    description?: string | undefined;
    chapterRef?: string | undefined;
}, {
    name: string;
    aliases?: string[] | undefined;
    description?: string | undefined;
    confidence?: number | undefined;
    chapterRef?: string | undefined;
}>;
export declare const characterCreateSchema: z.ZodObject<{
    name: z.ZodString;
    aliases: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    description: z.ZodOptional<z.ZodString>;
    confidence: z.ZodDefault<z.ZodNumber>;
    chapterRef: z.ZodOptional<z.ZodString>;
} & {
    bookId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    name: string;
    bookId: string;
    aliases: string[];
    confidence: number;
    description?: string | undefined;
    chapterRef?: string | undefined;
}, {
    name: string;
    bookId: string;
    aliases?: string[] | undefined;
    description?: string | undefined;
    confidence?: number | undefined;
    chapterRef?: string | undefined;
}>;
export declare const characterUpdateSchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    aliases: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    description: z.ZodOptional<z.ZodString>;
    status: z.ZodOptional<z.ZodEnum<["PENDING", "APPROVED", "REJECTED"]>>;
}, "strip", z.ZodTypeAny, {
    name?: string | undefined;
    status?: "PENDING" | "APPROVED" | "REJECTED" | undefined;
    aliases?: string[] | undefined;
    description?: string | undefined;
}, {
    name?: string | undefined;
    status?: "PENDING" | "APPROVED" | "REJECTED" | undefined;
    aliases?: string[] | undefined;
    description?: string | undefined;
}>;
export type CharacterInput = z.infer<typeof characterSchema>;
export type CharacterCreateInput = z.infer<typeof characterCreateSchema>;
export type CharacterUpdateInput = z.infer<typeof characterUpdateSchema>;
//# sourceMappingURL=character.d.ts.map