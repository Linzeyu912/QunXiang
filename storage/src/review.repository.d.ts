import type { CharacterReview } from '@novel-agent/core';
export declare const ReviewRepository: {
    create(data: {
        characterId: string;
        userId: string;
        action: string;
        previousValue?: string;
        newValue?: string;
    }): Promise<CharacterReview>;
    findByCharacterId(characterId: string): Promise<CharacterReview[]>;
};
//# sourceMappingURL=review.repository.d.ts.map