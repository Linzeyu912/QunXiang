import { describe, expect, it } from 'vitest';
import { executeResolution } from './resolution.agent.js';
import type { CharacterDescriptionPack, ItemDescriptionPack, LocationDescriptionPack } from './entity-descriptions.js';

describe('executeResolution', () => {
  it('passes character description packs through after entity resolution', async () => {
    const characterDescriptions: CharacterDescriptionPack[] = [{
      entityType: 'character',
      name: '萧炎',
      aliases: [],
      sourceDescription: '萧炎身穿黑色衣衫。',
      fields: {
        appearance: '',
        clothing: '萧炎身穿黑色衣衫',
        body: '',
        temperament: '',
        signatureItems: '',
        abilityVisuals: '',
        statusMarkers: '',
      },
      missingFields: ['appearance', 'body', 'temperament', 'signatureItems', 'abilityVisuals', 'statusMarkers'],
      evidenceSnippets: [{
        chapterIndex: 1,
        text: '萧炎身穿黑色衣衫。',
        matchedNames: ['萧炎'],
        fields: ['clothing'],
      }],
      sourceCoverage: 'partial',
      confidence: 0.28,
      needsReview: true,
    }];
    const itemDescriptions: ItemDescriptionPack[] = [{
      entityType: 'item',
      name: '青木剑',
      aliases: [],
      sourceDescription: '青木剑通体青色。',
      fields: {
        material: '',
        colorShape: '青木剑通体青色',
        condition: '',
        usage: '',
        visualEffects: '',
        ownership: '',
      },
      missingFields: ['material', 'condition', 'usage', 'visualEffects', 'ownership'],
      evidenceSnippets: [],
      sourceCoverage: 'partial',
      confidence: 0.2,
      needsReview: true,
    }];
    const locationDescriptions: LocationDescriptionPack[] = [{
      entityType: 'location',
      name: '乌坦城大厅',
      aliases: ['大厅'],
      sourceDescription: '大厅灯火明亮。',
      fields: {
        environment: '大厅',
        layout: '',
        atmosphere: '',
        lighting: '大厅灯火明亮',
        time: '',
        actionContext: '',
      },
      missingFields: ['layout', 'atmosphere', 'time', 'actionContext'],
      evidenceSnippets: [],
      sourceCoverage: 'partial',
      confidence: 0.3,
      needsReview: true,
    }];

    const result = await executeResolution({
      characters: [{
        name: '萧炎',
        aliases: [],
        description: '萧家三少爷',
        confidence: 0.9,
        status: 'PENDING',
        chapterAppearances: [1],
        mentionCount: 2,
        dialogueCount: 0,
        coCharacters: [],
      }],
      locations: [],
      items: [],
      characterDescriptions,
      itemDescriptions,
      locationDescriptions,
    });

    expect(result.characterDescriptions).toEqual(characterDescriptions);
    expect(result.itemDescriptions).toEqual(itemDescriptions);
    expect(result.locationDescriptions).toEqual(locationDescriptions);
  });
});
