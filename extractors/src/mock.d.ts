import type { Character } from '@novel-agent/core';
declare const MOCK_CHARACTERS: Omit<Character, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>[];
/**
 * Mock character extraction
 * In MVP, this returns hardcoded Journey to the West characters
 * In production, this would call LLM API
 */
export declare function extractCharacters(bookTitle: string, _chapters: Array<{
    index: number;
    content: string;
    title?: string;
}>): Promise<Omit<Character, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>[]>;
export { MOCK_CHARACTERS };
//# sourceMappingURL=mock.d.ts.map