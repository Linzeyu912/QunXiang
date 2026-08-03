import { describe, expect, it } from 'vitest';
import { computeContentRevision, type ContentRevisionInput } from './content-revision.js';

function baseInput(over: Partial<ContentRevisionInput> = {}): ContentRevisionInput {
  return {
    bookUpdatedAt: '2026-07-19T00:00:00.000Z',
    run: { runDir: 'book-20260719', generatedAt: '2026-07-19T00:00:00.000Z' },
    entityHashes: { characters: 'c1', locations: 'l1', items: 'i1' },
    noiseOverrideHash: 'n1',
    storyHash: 's1',
    ...over,
  };
}

describe('computeContentRevision', () => {
  it('相同输入产生相同 revision', () => {
    expect(computeContentRevision(baseInput())).toBe(computeContentRevision(baseInput()));
  });

  it('bookUpdatedAt 变化则 revision 变化', () => {
    expect(computeContentRevision(baseInput({ bookUpdatedAt: '2026-07-20T00:00:00.000Z' })))
      .not.toBe(computeContentRevision(baseInput()));
  });

  it('run 变化则 revision 变化', () => {
    expect(computeContentRevision(baseInput({ run: { runDir: 'book-20260720', generatedAt: '2026-07-20T00:00:00.000Z' } })))
      .not.toBe(computeContentRevision(baseInput()));
  });

  it('任一实体哈希变化则 revision 变化', () => {
    const changed = baseInput({ entityHashes: { characters: 'c2', locations: 'l1', items: 'i1' } });
    expect(computeContentRevision(changed)).not.toBe(computeContentRevision(baseInput()));
  });

  it('noiseOverrideHash 变化则 revision 变化', () => {
    expect(computeContentRevision(baseInput({ noiseOverrideHash: 'n2' })))
      .not.toBe(computeContentRevision(baseInput()));
  });

  it('storyHash 变化则 revision 变化', () => {
    expect(computeContentRevision(baseInput({ storyHash: 's2' })))
      .not.toBe(computeContentRevision(baseInput()));
  });

  it('run 为 null 时仍可计算且与有 run 时不同', () => {
    const noRun = computeContentRevision(baseInput({ run: null }));
    expect(noRun).toBeTruthy();
    expect(noRun).not.toBe(computeContentRevision(baseInput()));
  });

  it('revision 是 64 位十六进制', () => {
    expect(computeContentRevision(baseInput())).toMatch(/^[0-9a-f]{64}$/);
  });
});
