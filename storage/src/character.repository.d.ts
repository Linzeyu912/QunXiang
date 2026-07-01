import type { Character } from '@novel-agent/core';
export declare const CharacterRepository: {
    create(data: {
        bookId: string;
        name: string;
        aliases: string[];
        description?: string;
        confidence: number;
        chapterRef?: string;
    }): Promise<Character>;
    createMany(characters: Array<{
        bookId: string;
        name: string;
        aliases: string[];
        description?: string;
        confidence: number;
        chapterRef?: string;
    }>): Promise<number>;
    findByBookId(bookId: string): Promise<Character[]>;
    findById(id: string): Promise<Character | null>;
    findByStatus(bookId: string, status: string): Promise<Character[]>;
    update(id: string, data: Partial<Character>): Promise<Character>;
    updateStatus(id: string, status: string): Promise<Character>;
    deleteByBookId(bookId: string): Promise<void>;
};
//# sourceMappingURL=character.repository.d.ts.map