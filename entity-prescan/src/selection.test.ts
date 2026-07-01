import { describe, expect, it } from 'vitest';
import { selectOutputEntities } from './selection.js';
import type { EntityImportance } from './importance.js';
import type { EntityMention, EntityType } from './types.js';

function mention(text: string): EntityMention {
  return {
    text,
    chapterIndex: 0,
    position: 0,
    source: 'regex',
    confidence: 0.8,
  };
}

function importance(text: string, score: number): EntityImportance {
  return {
    text,
    type: 'character',
    pillars: { causalNecessity: 1, informationUniqueness: 0, stateTransition: 0 },
    storyScore: score >= 0.3 ? 2 : 0,
    storyValue: score >= 0.3 ? 0.33 : 0,
    production: { writingCompleteness: 0, adaptationUsability: 0, score: 0 },
    importance: score,
    tier: score >= 0.3 ? 'candidate' : 'archived',
    quadrant: score >= 0.3 ? 'candidate' : 'archived',
    mentionCount: 1,
    chapters: [0],
  };
}

describe('selectOutputEntities', () => {
  it('drops archived entities from final output but keeps candidate-or-better entities', () => {
    const kept = '\u8bb8\u4e03\u5b89';
    const archived = '\u8bb8\u591a';
    const filtered = new Map<EntityType, EntityMention[]>([
      ['character', [mention(kept), mention(archived)]],
    ]);
    const importances = new Map<EntityType, EntityImportance[]>([
      ['character', [importance(kept, 0.35), importance(archived, 0.2)]],
    ]);
    const scoring = new Map<EntityType, Map<string, { confidence: { overall: number } }>>([
      ['character', new Map([
        [kept, { confidence: { overall: 0.5 } }],
        [archived, { confidence: { overall: 0.5 } }],
      ])],
    ]);

    const selected = selectOutputEntities(filtered, importances, scoring as never);

    expect(selected.get('character')?.map((m) => m.text)).toEqual([kept]);
  });
});
