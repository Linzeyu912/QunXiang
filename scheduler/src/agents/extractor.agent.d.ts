import type { AgentType, Character, Location, Item } from '@novel-agent/core';
import type { CharacterDescriptionPack, ItemDescriptionPack, LocationDescriptionPack } from './entity-descriptions.js';
export declare const extractorAgentType: AgentType;
export interface ExtractorPayload {
    bookId: string;
}
export interface ExtractorResult {
    characters: Omit<Character, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>[];
    locations: Omit<Location, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>[];
    items: Omit<Item, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>[];
    events?: import('@novel-agent/entity-prescan').EntityMention[];
    runDirName?: string;
    characterDescriptions?: CharacterDescriptionPack[];
    itemDescriptions?: ItemDescriptionPack[];
    locationDescriptions?: LocationDescriptionPack[];
    failedBatches?: {
        batch: number;
        error: string;
    }[];
    totalBatches?: number;
    successfulBatches?: number;
}
export declare function executeExtractor(payload: unknown): Promise<ExtractorResult>;
//# sourceMappingURL=extractor.agent.d.ts.map
