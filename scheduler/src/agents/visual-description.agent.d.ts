import type { AgentType, Character, Item, Location } from '@novel-agent/core';
import type { CharacterDescriptionField, CharacterDescriptionPack, EntityDescriptionPack, ItemDescriptionField, ItemDescriptionPack, LocationDescriptionField, LocationDescriptionPack } from './entity-descriptions.js';
export declare const visualDescriptionAgentType: AgentType;
export type VisualCompletionStatus = 'source_only' | 'llm_completed' | 'llm_inferred';
export type VisualDescriptionSource = 'source' | 'llm' | 'mixed';
export interface EnhancedEntityDescriptionPack<EntityType extends string, Field extends string> extends EntityDescriptionPack<EntityType, Field> {
    visualFields: Record<Field, string>;
    visualDetails: Record<string, string>;
    inferredFields: Field[];
    summarizedFields: Field[];
    enhancedDescription: string;
    finalDescription: string;
    llmSupplement: string;
    supplementDescription: string;
    completionStatus: VisualCompletionStatus;
    descriptionSource: VisualDescriptionSource;
}
export type CharacterVisualDescriptionPack = EnhancedEntityDescriptionPack<'character', CharacterDescriptionField>;
export type ItemVisualDescriptionPack = EnhancedEntityDescriptionPack<'item', ItemDescriptionField>;
export type LocationVisualDescriptionPack = EnhancedEntityDescriptionPack<'location', LocationDescriptionField>;
type CharacterEntity = Omit<Character, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>;
type ItemEntity = Omit<Item, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>;
type LocationEntity = Omit<Location, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>;
export interface VisualDescriptionPayload extends Record<string, unknown> {
    characters: CharacterEntity[];
    locations?: LocationEntity[];
    items?: ItemEntity[];
    characterDescriptions?: CharacterDescriptionPack[];
    itemDescriptions?: ItemDescriptionPack[];
    locationDescriptions?: LocationDescriptionPack[];
}
export interface VisualDescriptionResult extends VisualDescriptionPayload {
    characters: CharacterEntity[];
    locations: LocationEntity[];
    items: ItemEntity[];
    characterVisualDescriptions: CharacterVisualDescriptionPack[];
    itemVisualDescriptions: ItemVisualDescriptionPack[];
    locationVisualDescriptions: LocationVisualDescriptionPack[];
    visualDescription: {
        requested: number;
        completed: number;
        sourceOnly: number;
        inferred: number;
    };
}
export declare function executeVisualDescription(payload: unknown): Promise<VisualDescriptionResult>;
export {};
