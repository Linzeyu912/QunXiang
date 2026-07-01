import { describe, expect, it } from 'vitest';
import { EXTRACTION_PIPELINE, getNextAgent } from './pipeline.js';

describe('EXTRACTION_PIPELINE', () => {
  it('runs visual description completion after description fusion and before reviewer persistence', () => {
    expect(EXTRACTION_PIPELINE).toEqual([
      'extractor',
      'validator',
      'entity-resolution',
      'description-fusion',
      'visual-description',
      'reviewer',
    ]);
    expect(getNextAgent('entity-resolution')).toBe('description-fusion');
    expect(getNextAgent('description-fusion')).toBe('visual-description');
    expect(getNextAgent('visual-description')).toBe('reviewer');
  });
});
