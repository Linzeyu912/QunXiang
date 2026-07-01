import type { AgentType, Character, Location, Item } from '@novel-agent/core';
import { resolve } from '@novel-agent/entity-resolution';
import type { CharacterDescriptionPack, ItemDescriptionPack, LocationDescriptionPack } from './entity-descriptions.js';

export const resolutionAgentType: AgentType = 'entity-resolution';

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

export async function executeResolution(payload: unknown): Promise<ResolutionResult> {
  const { characters, locations = [], items = [], characterDescriptions, itemDescriptions, locationDescriptions } = payload as ResolutionPayload;

  const result = resolve(characters);

  return {
    characters: result.characters,
    merged: result.merged,
    locations,
    items,
    characterDescriptions,
    itemDescriptions,
    locationDescriptions,
  };
}
