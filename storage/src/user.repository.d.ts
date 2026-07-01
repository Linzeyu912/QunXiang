import type { User } from '@novel-agent/core';
export declare const UserRepository: {
    create(data: {
        email: string;
        name: string;
    }): Promise<User>;
    findById(id: string): Promise<User | null>;
    findByEmail(email: string): Promise<User | null>;
    findOrCreate(data: {
        email: string;
        name: string;
    }): Promise<User>;
};
//# sourceMappingURL=user.repository.d.ts.map