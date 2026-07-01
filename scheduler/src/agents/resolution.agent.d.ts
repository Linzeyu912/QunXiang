import type { AgentType, Character, Location, Item } from '@novel-agent/core';
import type { CharacterDescriptionPack, ItemDescriptionPack, LocationDescriptionPack } from './entity-descriptions.js';
export declare const resolutionAgentType: AgentType;
export interface ResolutionPayload {
    characters: Omit<Character, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>[];
    locations?: Omit<Location, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>[];
    items?: Omit<Item, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>[];
    characterDescriptions?: CharacterDescriptionPack[];
    itemDescriptions?: ItemDescriptionPack[];
    locationDescriptions?: LocationDescriptionPack[];
}
export interface ResolutionResult {
    characters: Omit<Character, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>[];
    merged: number;
    locations: Omit<Location, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>[];
    items: Omit<Item, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>[];
    characterDescriptions?: CharacterDescriptionPack[];
    itemDescriptions?: ItemDescriptionPack[];
    locationDescriptions?: LocationDescriptionPack[];
}
export declare function executeResolution(payload: unknown): Promise<ResolutionResult>;
//# sourceMappingURL=resolution.agent.d.ts.map
