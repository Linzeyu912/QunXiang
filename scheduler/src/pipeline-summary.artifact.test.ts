import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  // 捕获 persistBookArtifact 入参（= 对象存储 put + BookArtifact upsert 协调点）
  persisted: [] as Array<{ bookId: string; logicalPath: string; category: string; body: string; mime: string }>,
  reset() { this.persisted.length = 0; },
}));

vi.mock('@novel-agent/storage', () => ({
  // DB 不可用 → 走 payload 回退（不依赖真实数据库）
  BookRepository: { async findById() { return null; } },
  CharacterRepository: { async findByBookId() { return []; } },
  LocationRepository: { async findByBookId() { return []; } },
  ItemRepository: { async findByBookId() { return []; } },
  // 捕获双写入参（persistBookArtifact 是 put + upsert 的协调点）
  persistBookArtifact: vi.fn(async (input: { bookId: string; logicalPath: string; category: string; body: string; mime: string }) => {
    mockState.persisted.push({ ...input });
  }),
}));

import { writePipelineFinalSummary } from './pipeline-summary.js';

describe('pipeline-summary 产物对象化双写', () => {
  beforeEach(() => mockState.reset());

  it('writePipelineFinalSummary 后 run-summary 与各 entities/* 均写入 BookArtifact + 对象存储', async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), 'pipeline-artifact-'));
    try {
      await writePipelineFinalSummary(
        'book-art-1',
        {
          runDirName: 'book-art-1-run',
          characters: [{ name: '萧炎' }],
          locations: [{ name: '乌坦城' }],
          items: [{ name: '青木剑' }],
          events: [{ text: '退婚', chapterIndex: 1 }],
          characterDescriptions: [{ entityType: 'character', name: '萧炎', sourceDescription: '黑衣' }],
          characterPrompts: [{ entityName: '萧炎', entityType: 'character', prompt: 'a boy' }],
        },
        { count: 1 },
        outputRoot,
      );

      // 本机文件确已落盘（双写保留 output/）
      const summary = JSON.parse(await readFile(join(outputRoot, 'book-art-1-run', 'final', 'run-summary.json'), 'utf-8'));
      expect(summary.officialResult).toBe(true);

      const paths = mockState.persisted.map((p) => `${p.category}|${p.logicalPath}`).sort();
      expect(paths).toContain('run-summary|run-summary.json');
      expect(paths).toContain('extraction|entities/characters.json');
      expect(paths).toContain('extraction|entities/items.json');
      expect(paths).toContain('extraction|entities/locations.json');
      expect(paths).toContain('extraction|entities/events.json');
      expect(paths).toContain('extraction|entities/character-descriptions.json');
      expect(paths).toContain('extraction|entities/character-prompts.json');
      expect(paths).toContain('extraction|entities/summary.md');

      // logicalPath 不含 runDir（最新 run 覆盖语义）；body 非空；bookId 正确
      for (const p of mockState.persisted) {
        expect(p.logicalPath).not.toMatch(/book-art-1-run/);
        expect(p.bookId).toBe('book-art-1');
        expect(p.body.length).toBeGreaterThan(0);
      }

      // mime 正确：summary.md → text/markdown；run-summary.json → application/json
      expect(mockState.persisted.find((p) => p.logicalPath === 'entities/summary.md')?.mime).toBe('text/markdown');
      const runSummary = mockState.persisted.find((p) => p.logicalPath === 'run-summary.json');
      expect(runSummary?.mime).toBe('application/json');
      expect(runSummary?.category).toBe('run-summary');

      // run-summary.json 的 body 是合法 JSON 且包含 bookId
      const runSummaryBody = JSON.parse(runSummary!.body);
      expect(runSummaryBody.bookId).toBe('book-art-1');
      expect(runSummaryBody.officialResult).toBe(true);
    } finally {
      await rm(outputRoot, { recursive: true, force: true });
    }
  });
});
