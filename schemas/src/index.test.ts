import { describe, expect, it } from 'vitest';
import {
  extractionResultSchema,
  itemSchema,
  locationSchema,
} from './index.js';

describe('@novel-agent/schemas runtime exports', () => {
  it('exports extraction, item, and location schemas from the JavaScript runtime entrypoint', () => {
    expect(extractionResultSchema).toEqual(expect.objectContaining({ parse: expect.any(Function) }));
    expect(itemSchema).toEqual(expect.objectContaining({ parse: expect.any(Function) }));
    expect(locationSchema).toEqual(expect.objectContaining({ parse: expect.any(Function) }));
  });
});
