import { describe, expect, it } from 'vitest';
import { parseTxtEnhanced } from './index.js';

describe('@novel-agent/import runtime exports', () => {
  it('exports enhanced TXT parsing from the JavaScript runtime entrypoint', () => {
    expect(parseTxtEnhanced).toEqual(expect.any(Function));
  });
});
