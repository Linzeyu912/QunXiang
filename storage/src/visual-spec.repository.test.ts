import { describe, it, expect, beforeEach } from 'vitest';
import { createVisualSpecRepository, type VisualSpecRepository } from './visual-spec.repository.js';
import { createBookRepository, type BookRepository } from './book.repository.js';
import { createUserRepository, type UserRepository } from './user.repository.js';
import { testPrisma } from './test-setup.js';
import { testUserInput } from './test-fixtures.js';

describe('VisualSpecRepository', () => {
  let specRepo: VisualSpecRepository;
  let bookRepo: BookRepository;
  let userRepo: UserRepository;
  let testUser: { id: string };
  let testBook: { id: string };

  beforeEach(async () => {
    specRepo = createVisualSpecRepository(testPrisma);
    bookRepo = createBookRepository(testPrisma);
    userRepo = createUserRepository(testPrisma);
    await testPrisma.visualSpec.deleteMany();
    await testPrisma.book.deleteMany();
    await testPrisma.user.deleteMany();
    testUser = await userRepo.create(testUserInput('visualspec@example.com', '视觉规格测试用户'));
    testBook = await bookRepo.create({
      title: 'Visual Spec Book',
      filePath: '/tmp/visual-spec.txt',
      fileSize: 1024,
      mimeType: 'text/plain',
      userId: testUser.id,
    });
  });

  it('supersedes active specs and increments version on rewrite', async () => {
    await specRepo.createMany([{
      bookId: testBook.id,
      entityType: 'character',
      entityName: '萧炎',
      variantKey: 'primary',
      version: 1,
      prompt: 'v1',
      promptSource: 'template-only',
    }]);

    expect(await specRepo.maxVersion(testBook.id, 'character', '萧炎', 'primary')).toBe(1);
    expect(await specRepo.supersedeActive(testBook.id)).toBe(1);

    await specRepo.createMany([{
      bookId: testBook.id,
      entityType: 'character',
      entityName: '萧炎',
      variantKey: 'primary',
      version: 2,
      prompt: 'v2',
      promptSource: 'llm-polished',
    }]);

    const active = await specRepo.findActive(testBook.id, 'character', '萧炎', 'primary');
    expect(active?.version).toBe(2);
    expect(active?.prompt).toBe('v2');
    expect(await specRepo.maxVersion(testBook.id, 'character', '萧炎', 'primary')).toBe(2);
  });

  it('scopes owned lookup to the book owner', async () => {
    await specRepo.createMany([{
      bookId: testBook.id,
      entityType: 'item',
      entityName: '古戒',
      variantKey: 'primary',
      version: 1,
      prompt: 'ring',
      promptSource: 'template-only',
    }]);

    const owned = await specRepo.findOwnedActiveByEntity(testBook.id, testUser.id, 'item', '古戒');
    const stranger = await specRepo.findOwnedActiveByEntity(testBook.id, '00000000-0000-0000-0000-000000000000', 'item', '古戒');
    expect(owned).toHaveLength(1);
    expect(stranger).toHaveLength(0);
  });
});
