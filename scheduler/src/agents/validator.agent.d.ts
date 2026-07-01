import type { AgentType, Character, Location, Item } from '@novel-agent/core';
import type { CharacterDescriptionPack, ItemDescriptionPack, LocationDescriptionPack } from './entity-descriptions.js';
export declare const validatorAgentType: AgentType;
export interface ValidatorPayload {
    characters: Omit<Character, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>[];
    locations?: Omit<Location, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>[];
    items?: Omit<Item, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>[];
    characterDescriptions?: CharacterDescriptionPack[];
    itemDescriptions?: ItemDescriptionPack[];
    locationDescriptions?: LocationDescriptionPack[];
}
export interface ValidatorAgentResult {
    characters: Omit<Character, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>[];
    rejected: Array<{
        character: Omit<Character, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>;
        reason: string;
    }>;
    locations: Omit<Location, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>[];
    locationRejected: Array<{
        entity: Omit<Location, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>;
        reason: string;
    }>;
    items: Omit<Item, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>[];
    itemRejected: Array<{
        entity: Omit<Item, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>;
        reason: string;
    }>;
    characterDescriptions?: CharacterDescriptionPack[];
    itemDescriptions?: ItemDescriptionPack[];
    locationDescriptions?: LocationDescriptionPack[];
}
export declare function executeValidator(payload: unknown): Promise<ValidatorAgentResult>;
//# sourceMappingURL=validator.agent.d.ts.map
