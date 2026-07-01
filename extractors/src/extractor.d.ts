import type { Character } from '@novel-agent/core';
export interface Chapter {
    index: number;
    content: string;
    title?: string;
}
/**
 * Create an extractor function that uses LLM
 * Falls back to mock data if no LLM is available
 */
export declare function createExtractor(): (bookTitle: string, chapters: Chapter[]) => Promise<Omit<Character, "id" | "bookId" | "createdAt" | "updatedAt">[]>;
export declare const extractCharacters: (bookTitle: string, chapters: Chapter[]) => Promise<Omit<Character, "id" | "bookId" | "createdAt" | "updatedAt">[]>;
//# sourceMappingURL=extractor.d.ts.map