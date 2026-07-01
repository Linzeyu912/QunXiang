import type { Character, Item, Location } from '@novel-agent/core';
export interface DescriptionChapter {
    index: number;
    title?: string;
    content: string;
}
export type SourceCoverage = 'none' | 'partial' | 'strong';
export type CharacterDescriptionField = 'appearance' | 'clothing' | 'body' | 'temperament' | 'signatureItems' | 'abilityVisuals' | 'statusMarkers';
export type ItemDescriptionField = 'material' | 'colorShape' | 'condition' | 'usage' | 'visualEffects' | 'ownership';
export type LocationDescriptionField = 'environment' | 'layout' | 'atmosphere' | 'lighting' | 'time' | 'actionContext';
export interface DescriptionEvidenceSnippet<Field extends string = string> {
    chapterIndex: number;
    chapterTitle?: string;
    text: string;
    matchedNames: string[];
    otherMatchedNames?: string[];
    fields: Field[];
}
export interface EntityDescriptionPack<EntityType extends string, Field extends string> {
    entityType: EntityType;
    name: string;
    aliases: string[];
    sourceDescription: string;
    fields: Record<Field, string>;
    missingFields: Field[];
    evidenceSnippets: DescriptionEvidenceSnippet<Field>[];
    sourceCoverage: SourceCoverage;
    confidence: number;
    needsReview: boolean;
}
export type CharacterDescriptionPack = EntityDescriptionPack<'character', CharacterDescriptionField>;
export type ItemDescriptionPack = EntityDescriptionPack<'item', ItemDescriptionField>;
export type LocationDescriptionPack = EntityDescriptionPack<'location', LocationDescriptionField>;
type CharacterCandidate = Omit<Character, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>;
type ItemCandidate = Omit<Item, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>;
type LocationCandidate = Omit<Location, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>;
export declare function extractCharacterDescriptionPacks(characters: CharacterCandidate[], chapters: DescriptionChapter[]): CharacterDescriptionPack[];
export declare function extractItemDescriptionPacks(items: ItemCandidate[], chapters: DescriptionChapter[]): ItemDescriptionPack[];
export declare function extractLocationDescriptionPacks(locations: LocationCandidate[], chapters: DescriptionChapter[]): LocationDescriptionPack[];
export {};
