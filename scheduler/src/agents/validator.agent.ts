import type { AgentType, Character, Location, Item } from '@novel-agent/core';
import { validateCharacters, validateEntityBatch } from '@novel-agent/validators';
import type { CharacterDescriptionPack, ItemDescriptionPack, LocationDescriptionPack } from './entity-descriptions.js';

export const validatorAgentType: AgentType = 'validator';

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
  rejected: Array<{ character: Omit<Character, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>; reason: string }>;
  locations: Omit<Location, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>[];
  locationRejected: Array<{ entity: Omit<Location, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>; reason: string }>;
  items: Omit<Item, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>[];
  itemRejected: Array<{ entity: Omit<Item, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>; reason: string }>;
  characterDescriptions?: CharacterDescriptionPack[];
  itemDescriptions?: ItemDescriptionPack[];
  locationDescriptions?: LocationDescriptionPack[];
}

export async function executeValidator(payload: unknown): Promise<ValidatorAgentResult> {
  const { characters, locations = [], items = [], characterDescriptions, itemDescriptions, locationDescriptions } = payload as ValidatorPayload;

  const { valid, rejected } = validateCharacters(characters);

  const locationResult = validateEntityBatch(locations);
  const itemResult = validateEntityBatch(items);

  return {
    characters: valid.map(c => ({ ...c, status: 'PENDING' as const })),
    rejected,
    locations: locationResult.valid,
    locationRejected: locationResult.rejected,
    items: itemResult.valid,
    itemRejected: itemResult.rejected,
    characterDescriptions,
    itemDescriptions,
    locationDescriptions,
  };
}
