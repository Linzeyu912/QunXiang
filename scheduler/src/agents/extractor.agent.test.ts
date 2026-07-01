import { describe, expect, it } from 'vitest';

describe('extractor entity-only pipeline', () => {
  it('does not expose story asset extraction from the entity extractor', async () => {
    const extractorModule = await import('./extractor.agent.js');

    expect(extractorModule).not.toHaveProperty('extractStoryAssetsForEnhancedResult');
  });
});
