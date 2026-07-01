import type { Book } from '@novel-agent/core';
export declare const BookRepository: {
    create(data: {
        title: string;
        content: string;
        userId: string;
    }): Promise<Book>;
    findById(id: string): Promise<Book | null>;
    findAll(userId: string): Promise<Book[]>;
    updateStatus(id: string, status: string): Promise<Book>;
    delete(id: string): Promise<void>;
};
//# sourceMappingURL=book.repository.d.ts.map