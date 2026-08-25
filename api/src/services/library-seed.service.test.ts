import { describe, expect, it } from 'vitest';
import {
  parseManifest,
  assertCountsMatch,
  mapCharacterRows,
  mapLocationRows,
  mapItemRows,
  mapWorldviewRows,
  rewriteRunSummary,
} from './library-seed.service.js';

const validManifest = {
  slug: 'demo-book',
  title: '演示之书',
  version: 1,
  exportedAt: '2026-07-24T00:00:00.000Z',
  sourceFile: 'source.txt',
  fileSize: 12345,
  counts: { characters: 1, locations: 1, items: 1, worldviews: 1, images: 2 },
};

describe('parseManifest', () => {
  it('接受合法 manifest', () => {
    const m = parseManifest(validManifest);
    expect(m.slug).toBe('demo-book');
    expect(m.counts.images).toBe(2);
  });

  it('拒绝缺字段 / 未知版本', () => {
    expect(() => parseManifest({ ...validManifest, title: '' })).toThrow();
    expect(() => parseManifest({ ...validManifest, version: 2 })).toThrow();
    expect(() => parseManifest({ ...validManifest, counts: { characters: 1 } })).toThrow();
    expect(() => parseManifest(null)).toThrow();
  });
});

describe('assertCountsMatch', () => {
  const manifest = parseManifest(validManifest);

  it('计数一致时通过', () => {
    expect(() =>
      assertCountsMatch(
        manifest,
        { characters: [{}], locations: [{}], items: [{}], worldviews: [{}] },
        2,
      ),
    ).not.toThrow();
  });

  it('计数不符时抛出并指出差异项', () => {
    expect(() =>
      assertCountsMatch(manifest, { characters: [{}, {}], locations: [{}], items: [], worldviews: [] }, 1),
    ).toThrow(/计数不一致/);
  });
});

describe('实体行映射（三表字段集差异）', () => {
  const base = {
    name: '萧炎',
    aliases: ['小炎子'],
    description: '主角',
    confidence: 0.9,
    chapterRef: '第1章',
    firstChapter: 1,
    lastChapter: 10,
    chapterAppearances: [{ chapter: 1 }],
    mentionCount: 42,
    // 导出工具已剥掉的字段若混入，映射层需再防御
    id: 'should-be-dropped',
    bookId: 'should-be-dropped',
    status: 'PENDING',
  };

  it('Character：保留角色字段（含 dialogueCount/coCharacters/outfits），不含 tier/pillar', () => {
    const [row] = mapCharacterRows(
      [{ ...base, dialogueCount: 7, coCharacters: ['药老'], outfits: [], tier: 'core', importanceScore: 99 }],
      'new-book-id',
    );
    expect(row.bookId).toBe('new-book-id');
    expect(row.status).toBe('APPROVED');
    expect(row.dialogueCount).toBe(7);
    expect(row.tier).toBeUndefined();
    expect(row.importanceScore).toBeUndefined();
    expect(row.id).toBeUndefined();
  });

  it('Location：保留 tier/importanceScore/pillar，无 owners/dialogueCount', () => {
    const [row] = mapLocationRows(
      [{ ...base, tier: 'core', importanceScore: 8.5, pillarCausal: 3, owners: ['x'], dialogueCount: 5 }],
      'bid',
    );
    expect(row.tier).toBe('core');
    expect(row.importanceScore).toBe(8.5);
    expect(row.pillarCausal).toBe(3);
    expect(row.owners).toBeUndefined();
    expect(row.dialogueCount).toBeUndefined();
    expect(row.status).toBe('APPROVED');
  });

  it('Item：保留 owners', () => {
    const [row] = mapItemRows([{ ...base, owners: ['萧炎'] }], 'bid');
    expect(row.owners).toEqual(['萧炎']);
    expect(row.status).toBe('APPROVED');
  });

  it('Worldview：保留世界观字段并统一标记为已审核', () => {
    const [row] = mapWorldviewRows(
      [{ ...base, category: 'power-system', importanceScore: 9, tier: 'core', chapterAppearances: [1, 2] }],
      'bid',
    );
    expect(row.bookId).toBe('bid');
    expect(row.status).toBe('APPROVED');
    expect(row.category).toBe('power-system');
    expect(row.chapterAppearances).toEqual([1, 2]);
    expect(row.id).toBeUndefined();
  });

  it('缺失的可选字段不写入（交给 DB 默认值）', () => {
    const [row] = mapCharacterRows([{ name: '路人' }], 'bid');
    expect(row.name).toBe('路人');
    expect('description' in row).toBe(false);
    expect('mentionCount' in row).toBe(false);
  });
});

describe('rewriteRunSummary', () => {
  it('只改 bookId，其余字段原样保留', () => {
    const summary = {
      bookId: 'old-id',
      officialResult: true,
      generatedAt: '2026-07-01',
      outputs: { finalSummary: 'output/run-x/final/run-summary.json' },
      counts: { characters: 10 },
    };
    const rewritten = rewriteRunSummary(summary, 'new-id');
    expect(rewritten.bookId).toBe('new-id');
    expect(rewritten.officialResult).toBe(true);
    expect(rewritten.outputs).toEqual(summary.outputs);
    // 不修改原对象
    expect(summary.bookId).toBe('old-id');
  });
});
