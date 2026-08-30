import { describe, it, expect, beforeEach } from 'vitest';
import { createExtractionResidueCleanup } from './extraction-residue-cleanup.js';
import { createBookRepository, createUserRepository } from './index.js';
import { testPrisma } from './test-setup.js';
import { testUserInput } from './test-fixtures.js';

describe('ExtractionResidueCleanup', () => {
  let bookId: string;
  let otherBookId: string;

  beforeEach(async () => {
    await testPrisma.entityImage.deleteMany();
    await testPrisma.visualSpec.deleteMany();
    await testPrisma.character.deleteMany();
    await testPrisma.worldviewSetting.deleteMany();
    await testPrisma.book.deleteMany();
    await testPrisma.user.deleteMany();

    const user = await createUserRepository(testPrisma).create(testUserInput('cleanup@test', '清理测试'));
    const bookRepo = createBookRepository(testPrisma);
    const mk = (title: string) =>
      bookRepo.create({ title, filePath: '', fileSize: 1, mimeType: 'text/plain', userId: user.id });
    bookId = (await mk('清理主书')).id;
    otherBookId = (await mk('另一本书')).id;
  });

  async function seedSpec(book: string, version: number) {
    await testPrisma.visualSpec.create({
      data: {
        bookId: book, entityType: 'character', entityName: '韩立',
        variantKey: 'primary', version, prompt: `v${version}`, promptSource: 'llm-polished',
      },
    });
  }

  it('VisualSpec 每变体只保留最新 version', async () => {
    await seedSpec(bookId, 1);
    await seedSpec(bookId, 2);
    await seedSpec(bookId, 3);
    const result = await createExtractionResidueCleanup(testPrisma).cleanup(bookId);
    expect(result.supersededSpecs).toBe(2);
    const left = await testPrisma.visualSpec.findMany({ where: { bookId } });
    expect(left).toHaveLength(1);
    expect(left[0].version).toBe(3);
  });

  it('归档实体删除，未归档与人工保留项不受影响', async () => {
    await testPrisma.character.create({ data: { bookId, name: '归档甲', archivedAt: new Date(), mentionCount: 1, confidence: 0.5 } });
    await testPrisma.character.create({ data: { bookId, name: '现行乙', mentionCount: 2, confidence: 0.5 } });
    await testPrisma.character.create({ data: { bookId, name: '人工保留丙', missingFromLatestRun: true, mentionCount: 3, confidence: 0.5 } });

    const result = await createExtractionResidueCleanup(testPrisma).cleanup(bookId);
    expect(result.archivedEntities).toBe(1);
    const names = (await testPrisma.character.findMany({ where: { bookId } })).map((c) => c.name).sort();
    expect(names).toEqual(['人工保留丙', '现行乙']);
  });

  it('归档实体的软关联图片一并删除（worldview 类型映射）', async () => {
    await testPrisma.worldviewSetting.create({ data: { bookId, name: '旧世界观', archivedAt: new Date(), confidence: 0.5 } });
    await testPrisma.entityImage.create({ data: { bookId, entityType: 'worldview', entityName: '旧世界观', filePath: '/a.png', mime: 'image/png', ext: 'png', bytes: 1 } });
    await testPrisma.entityImage.create({ data: { bookId, entityType: 'character', entityName: '现行乙', filePath: '/b.png', mime: 'image/png', ext: 'png', bytes: 1 } });

    const result = await createExtractionResidueCleanup(testPrisma).cleanup(bookId);
    expect(result.archivedEntities).toBe(1);
    expect(result.orphanImages).toBe(1);
    const imgs = await testPrisma.entityImage.findMany({ where: { bookId } });
    expect(imgs).toHaveLength(1);
    expect(imgs[0].entityName).toBe('现行乙');
  });

  it('dry-run 只统计不删除', async () => {
    await seedSpec(bookId, 1);
    await seedSpec(bookId, 2);
    await testPrisma.character.create({ data: { bookId, name: '归档甲', archivedAt: new Date(), mentionCount: 1, confidence: 0.5 } });

    const result = await createExtractionResidueCleanup(testPrisma).cleanup(bookId, { dryRun: true });
    expect(result.supersededSpecs).toBe(1);
    expect(result.archivedEntities).toBe(1);
    expect(await testPrisma.visualSpec.count({ where: { bookId } })).toBe(2);
    expect(await testPrisma.character.count({ where: { bookId } })).toBe(1);
  });

  it('bookId 过滤：只清目标书，另一本书不动', async () => {
    await seedSpec(otherBookId, 1);
    await seedSpec(otherBookId, 2);
    await testPrisma.character.create({ data: { bookId: otherBookId, name: '另书归档', archivedAt: new Date(), mentionCount: 1, confidence: 0.5 } });

    const result = await createExtractionResidueCleanup(testPrisma).cleanup(bookId);
    expect(result.supersededSpecs).toBe(0);
    expect(result.archivedEntities).toBe(0);
    expect(await testPrisma.visualSpec.count({ where: { bookId: otherBookId } })).toBe(2);
  });
});
