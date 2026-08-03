import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createBookArtifactRepository } from './book-artifact.repository.js';
import { cleanupTestDb, testPrisma } from './test-setup.js';
import { testUserInput } from './test-fixtures.js';

const repo = createBookArtifactRepository(testPrisma);

async function seedBook() {
  const user = await testPrisma.user.create({ data: testUserInput(`art-${randomUUID()}@test`) });
  const book = await testPrisma.book.create({
    data: { title: '产物测试书', filePath: '', fileSize: 1, userId: user.id },
  });
  return { user, book };
}

describe('BookArtifactRepository', () => {
  afterEach(async () => {
    await testPrisma.bookArtifact.deleteMany();
    await testPrisma.book.deleteMany();
    await testPrisma.user.deleteMany();
  });
  afterAll(cleanupTestDb);

  it('upsert 新建产物', async () => {
    const { book } = await seedBook();
    const a = await repo.upsert({
      bookId: book.id,
      logicalPath: 'entities/characters.json',
      category: 'extraction',
      objectKey: 'obj/aa/bb/k1',
      sha256: 'a'.repeat(64),
      bytes: BigInt(10),
      mime: 'application/json',
    });
    expect(a.bookId).toBe(book.id);
    expect(a.logicalPath).toBe('entities/characters.json');
  });

  it('upsert 同 (bookId, logicalPath) 覆盖（最新 run 胜）', async () => {
    const { book } = await seedBook();
    await repo.upsert({ bookId: book.id, logicalPath: 'run-summary.json', category: 'run-summary', objectKey: 'obj/aa/bb/old', sha256: 'b'.repeat(64), bytes: BigInt(1), mime: 'application/json' });
    const updated = await repo.upsert({ bookId: book.id, logicalPath: 'run-summary.json', category: 'run-summary', objectKey: 'obj/aa/bb/new', sha256: 'c'.repeat(64), bytes: BigInt(2), mime: 'application/json' });
    expect(updated.objectKey).toBe('obj/aa/bb/new');
    expect(updated.bytes).toBe(BigInt(2));
    // 唯一约束：只有一条
    const all = await repo.findByBook(book.id);
    expect(all.filter((x) => x.logicalPath === 'run-summary.json')).toHaveLength(1);
  });

  it('findByBook 返回该书全部产物（按 logicalPath 排序）', async () => {
    const { book } = await seedBook();
    await repo.upsert({ bookId: book.id, logicalPath: 'stories/seg.json', category: 'story', objectKey: 'obj/aa/bb/s', sha256: 'd'.repeat(64), bytes: BigInt(1), mime: 'application/json' });
    await repo.upsert({ bookId: book.id, logicalPath: 'entities/items.json', category: 'extraction', objectKey: 'obj/aa/bb/i', sha256: 'e'.repeat(64), bytes: BigInt(1), mime: 'application/json' });
    const all = await repo.findByBook(book.id);
    expect(all.map((x) => x.logicalPath)).toEqual(['entities/items.json', 'stories/seg.json']);
  });

  it('findByBookAndPath 命中/未命中', async () => {
    const { book } = await seedBook();
    await repo.upsert({ bookId: book.id, logicalPath: 'manifest.json', category: 'extraction', objectKey: 'obj/aa/bb/m', sha256: 'f'.repeat(64), bytes: BigInt(1), mime: 'application/json' });
    expect((await repo.findByBookAndPath(book.id, 'manifest.json'))?.objectKey).toBe('obj/aa/bb/m');
    expect(await repo.findByBookAndPath(book.id, 'not-exist.json')).toBeNull();
  });

  it('findByBookAndCategory 按类过滤', async () => {
    const { book } = await seedBook();
    await repo.upsert({ bookId: book.id, logicalPath: 'a.json', category: 'extraction', objectKey: 'obj/aa/bb/1', sha256: '1'.repeat(64), bytes: BigInt(1), mime: 'application/json' });
    await repo.upsert({ bookId: book.id, logicalPath: 'b.json', category: 'story', objectKey: 'obj/aa/bb/2', sha256: '2'.repeat(64), bytes: BigInt(1), mime: 'application/json' });
    const extraction = await repo.findByBookAndCategory(book.id, 'extraction');
    expect(extraction).toHaveLength(1);
    expect(extraction[0].logicalPath).toBe('a.json');
  });

  it('deleteForBook 随书级联删除', async () => {
    const { book } = await seedBook();
    await repo.upsert({ bookId: book.id, logicalPath: 'x.json', category: 'extraction', objectKey: 'obj/aa/bb/x', sha256: 'x'.repeat(64), bytes: BigInt(1), mime: 'application/json' });
    const count = await repo.deleteForBook(book.id);
    expect(count).toBe(1);
    expect(await repo.findByBook(book.id)).toHaveLength(0);
  });
});
