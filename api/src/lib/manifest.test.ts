import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  assertSafeManifestPath,
  buildManifest,
  manifestSha256,
  MANIFEST_SCHEMA_VERSION,
  type ManifestFile,
} from './manifest.js';

const _dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(_dirname, '..', 'snapshot', 'manifest-fixture');

async function fixtureFile(logicalPath: string, mime: string): Promise<ManifestFile> {
  const buf = await readFile(join(FIXTURE_DIR, logicalPath));
  return {
    logicalPath,
    bytes: buf.byteLength,
    mime,
    sha256: createHash('sha256').update(buf).digest('hex'),
  };
}

describe('assertSafeManifestPath', () => {
  it.each([
    ['绝对路径', '/etc/passwd'],
    ['反斜杠绝对', '\\windows\\system32'],
    ['Windows 盘符', 'C:/x'],
    ['协议', 'file://x'],
    ['上级目录段', 'a/../b'],
    ['当前目录段', 'a/./b'],
    ['空段', 'a//b'],
    ['NUL 字符', 'a\x00b'],
    ['空字符串', ''],
  ])('拒绝 %s', (_label, path) => {
    expect(() => assertSafeManifestPath(path)).toThrow();
  });

  it('接受合法相对路径', () => {
    expect(() => assertSafeManifestPath('source/原始书籍.txt')).not.toThrow();
    expect(() => assertSafeManifestPath('entities/characters.json')).not.toThrow();
  });
});

describe('buildManifest', () => {
  it('文件按 logicalPath 排序并带固定 schemaVersion', () => {
    const manifest = buildManifest({
      bookId: 'b1',
      snapshotId: 's1',
      generatedAt: '2026-07-19T00:00:00.000Z',
      sourceType: 'novel',
      categories: [{ category: 'source', state: 'present' }],
      files: [
        { logicalPath: 'source/z.txt', bytes: 1, mime: 'text/plain', sha256: 'a'.repeat(64) },
        { logicalPath: 'source/a.txt', bytes: 1, mime: 'text/plain', sha256: 'b'.repeat(64) },
      ],
    });
    expect(manifest.schemaVersion).toBe(MANIFEST_SCHEMA_VERSION);
    expect(manifest.files.map((f) => f.logicalPath)).toEqual(['source/a.txt', 'source/z.txt']);
  });

  it('资产类别记录三态与中文原因', () => {
    const manifest = buildManifest({
      bookId: 'b1',
      snapshotId: 's1',
      generatedAt: '2026-07-19T00:00:00.000Z',
      sourceType: 'novel',
      categories: [
        { category: 'source', state: 'present' },
        { category: 'review', state: 'empty', reason: '尚无审核记录' },
        { category: 'story', state: 'not-generated', reason: '未执行故事分割' },
      ],
      files: [],
    });
    expect(manifest.categories.map((c) => c.state)).toEqual(['present', 'empty', 'not-generated']);
    expect(manifest.categories[2].reason).toBe('未执行故事分割');
  });

  it('拒绝非法路径的文件', () => {
    expect(() => buildManifest({
      bookId: 'b1', snapshotId: 's1', generatedAt: '2026-07-19T00:00:00.000Z',
      sourceType: 'novel', categories: [],
      files: [{ logicalPath: '../escape', bytes: 1, mime: 'text/plain', sha256: 'a'.repeat(64) }],
    })).toThrow();
  });
});

describe('golden fixture manifest', () => {
  it('对脱敏 fixture 生成确定性 manifest', async () => {
    const pngBytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
      'base64',
    );
    const files: ManifestFile[] = [
      await fixtureFile('source.txt', 'text/plain').then((f) => ({ ...f, logicalPath: 'source/原始书籍.txt' })),
      await fixtureFile('entities/characters.json', 'application/json'),
      await fixtureFile('entities/locations.json', 'application/json'),
      await fixtureFile('entities/items.json', 'application/json'),
      {
        logicalPath: 'images/files/少年.png',
        bytes: pngBytes.byteLength,
        mime: 'image/png',
        sha256: createHash('sha256').update(pngBytes).digest('hex'),
      },
    ];

    const categories = [
      { category: 'source', state: 'present' as const },
      { category: 'entity', state: 'present' as const },
      { category: 'review', state: 'empty' as const, reason: '尚无审核记录' },
      { category: 'story', state: 'not-generated' as const, reason: '未执行故事分割' },
      { category: 'image', state: 'present' as const },
    ];

    const manifest = buildManifest({
      bookId: 'fixture-book',
      snapshotId: 'fixture-snapshot',
      generatedAt: '2026-07-19T00:00:00.000Z',
      sourceType: 'novel',
      categories,
      files,
    });

    expect(manifest.files.map((f) => f.logicalPath)).toEqual([
      'entities/characters.json',
      'entities/items.json',
      'entities/locations.json',
      'images/files/少年.png',
      'source/原始书籍.txt',
    ]);
    expect(manifestSha256(manifest)).toMatch(/^[0-9a-f]{64}$/);

    // 确定性：重复构建得到同一哈希
    const rebuilt = buildManifest({
      bookId: 'fixture-book',
      snapshotId: 'fixture-snapshot',
      generatedAt: '2026-07-19T00:00:00.000Z',
      sourceType: 'novel',
      categories,
      files: [...files].reverse(),
    });
    expect(manifestSha256(rebuilt)).toBe(manifestSha256(manifest));
  });
});
