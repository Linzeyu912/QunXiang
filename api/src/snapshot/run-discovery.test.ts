import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverCurrentRun } from './run-discovery.js';

describe('discoverCurrentRun', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'run-disc-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function writeRun(runDir: string, summary: Record<string, unknown>): void {
    mkdirSync(join(root, runDir, 'final'), { recursive: true });
    writeFileSync(join(root, runDir, 'final', 'run-summary.json'), JSON.stringify(summary), 'utf8');
  }

  it('按 bookId 过滤并取最新 generatedAt', async () => {
    writeRun('book-20260101', { bookId: 'b1', generatedAt: '2026-01-01T00:00:00.000Z', officialResult: true });
    writeRun('book-20260102', { bookId: 'b1', generatedAt: '2026-01-02T00:00:00.000Z', officialResult: true });
    writeRun('other-20260103', { bookId: 'b2', generatedAt: '2026-01-03T00:00:00.000Z', officialResult: true });
    const run = await discoverCurrentRun(root, 'b1');
    expect(run?.runDir).toBe('book-20260102');
  });

  it('过滤 officialResult === false 的运行', async () => {
    writeRun('book-bad', { bookId: 'b1', generatedAt: '2026-01-03T00:00:00.000Z', officialResult: false });
    writeRun('book-good', { bookId: 'b1', generatedAt: '2026-01-02T00:00:00.000Z' });
    const run = await discoverCurrentRun(root, 'b1');
    expect(run?.runDir).toBe('book-good');
  });

  it('无匹配运行返回 null', async () => {
    writeRun('book-other', { bookId: 'b2', generatedAt: '2026-01-01T00:00:00.000Z' });
    expect(await discoverCurrentRun(root, 'b1')).toBeNull();
  });

  it('outputRoot 不存在返回 null', async () => {
    expect(await discoverCurrentRun(join(root, 'missing'), 'b1')).toBeNull();
  });
});
