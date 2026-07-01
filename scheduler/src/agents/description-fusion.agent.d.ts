import type { AgentType, Character, Item, Location } from '@novel-agent/core';
import type { CharacterDescriptionPack, ItemDescriptionPack, LocationDescriptionPack } from './entity-descriptions.js';
export declare const descriptionFusionAgentType: AgentType;
type CharacterEntity = Omit<Character, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>;
type ItemEntity = Omit<Item, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>;
type LocationEntity = Omit<Location, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>;
export interface DescriptionFusionPayload extends Record<string, unknown> {
    characters: CharacterEntity[];
    locations?: LocationEntity[];
    items?: ItemEntity[];
    characterDescriptions?: CharacterDescriptionPack[];
    itemDescriptions?: ItemDescriptionPack[];
    locationDescriptions?: LocationDescriptionPack[];
}
export interface DescriptionFusionResult extends DescriptionFusionPayload {
    characters: CharacterEntity[];
    locations: LocationEntity[];
    items: ItemEntity[];
    descriptionFusion: {
        requested: number;
        fused: number;
        skipped: number;
    };
}
export declare function executeDescriptionFusion(payload: unknown): Promise<DescriptionFusionResult>;
export {};
