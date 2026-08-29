import { describe, it, expect, beforeEach } from 'vitest';
import { createBookRepository, type BookRepository } from './book.repository.js';
import { createUserRepository, type UserRepository } from './user.repository.js';
import { testPrisma } from './test-setup.js';
import { testUserInput } from './test-fixtures.js';
import { randomUUID } from 'node:crypto';

describe('BookRepository', () => {
  let bookRepo: BookRepository;
  let userRepo: UserRepository;
  let testUser: { id: string; email: string; name: string };

  beforeEach(async () => {
    bookRepo = createBookRepository(testPrisma);
    userRepo = createUserRepository(testPrisma);
    await testPrisma.book.deleteMany();
    await testPrisma.user.deleteMany();
    testUser = await userRepo.create(testUserInput('bookuser@example.com', '书籍测试用户'));
  });

  describe('create', () => {
    it('should create a book with required fields', async () => {
      const book = await bookRepo.create({
        title: 'Journey to the West',
        filePath: '/tmp/test.txt',
        fileSize: 1024,
        mimeType: 'text/plain',
        userId: testUser.id,
      });

      expect(book.title).toBe('Journey to the West');
      expect(book.filePath).toBe('/tmp/test.txt');
      expect(book.userId).toBe(testUser.id);
      expect(book.status).toBe('UPLOADED');
      expect(book.id).toBeDefined();
    });

    it('should generate unique ids for each book', async () => {
      const book1 = await bookRepo.create({ title: 'Book 1', filePath: '/tmp/test1.txt', fileSize: 1024, mimeType: 'text/plain', userId: testUser.id });
      const book2 = await bookRepo.create({ title: 'Book 2', filePath: '/tmp/test2.txt', fileSize: 1024, mimeType: 'text/plain', userId: testUser.id });

      expect(book1.id).not.toBe(book2.id);
    });
  });

  describe('findById', () => {
    it('should find a book by id', async () => {
      const created = await bookRepo.create({ title: 'Find Me', filePath: '/tmp/test.txt', fileSize: 1024, mimeType: 'text/plain', userId: testUser.id });
      const found = await bookRepo.findById(created.id);

      expect(found).not.toBeNull();
      expect(found?.title).toBe('Find Me');
    });

    it('should return null when book does not exist', async () => {
      const found = await bookRepo.findById(randomUUID());
      expect(found).toBeNull();
    });
  });

  describe('findAll', () => {
    it('should find all books for a user', async () => {
      await bookRepo.create({ title: 'Book 1', filePath: '/tmp/test1.txt', fileSize: 1024, mimeType: 'text/plain', userId: testUser.id });
      await bookRepo.create({ title: 'Book 2', filePath: '/tmp/test2.txt', fileSize: 1024, mimeType: 'text/plain', userId: testUser.id });

      const books = await bookRepo.findAll(testUser.id);

      expect(books).toHaveLength(2);
    });

    it('should return only books for the specified user', async () => {
      const otherUser = await userRepo.create(testUserInput('other@example.com', '其他用户'));
      await bookRepo.create({ title: 'My Book', filePath: '/tmp/test.txt', fileSize: 1024, mimeType: 'text/plain', userId: testUser.id });
      await bookRepo.create({ title: 'Other Book', filePath: '/tmp/other.txt', fileSize: 1024, mimeType: 'text/plain', userId: otherUser.id });

      const books = await bookRepo.findAll(testUser.id);

      expect(books).toHaveLength(1);
      expect(books[0].title).toBe('My Book');
    });

    it('should return books ordered by createdAt descending', async () => {
      const book1 = await bookRepo.create({ title: 'First', filePath: '/tmp/first.txt', fileSize: 1024, mimeType: 'text/plain', userId: testUser.id });
      const book2 = await bookRepo.create({ title: 'Second', filePath: '/tmp/second.txt', fileSize: 1024, mimeType: 'text/plain', userId: testUser.id });

      const books = await bookRepo.findAll(testUser.id);

      expect(books[0].title).toBe('Second');
      expect(books[1].title).toBe('First');
    });
  });

  describe('updateStatus', () => {
    it('should update book status', async () => {
      const book = await bookRepo.create({ title: 'Status Test', filePath: '/tmp/test.txt', fileSize: 1024, mimeType: 'text/plain', userId: testUser.id });

      const updated = await bookRepo.updateStatus(book.id, 'EXTRACTING');

      expect(updated.status).toBe('EXTRACTING');
    });

    it('should update status to EXTRACTED', async () => {
      const book = await bookRepo.create({ title: 'Status Test', filePath: '/tmp/test.txt', fileSize: 1024, mimeType: 'text/plain', userId: testUser.id });

      const updated = await bookRepo.updateStatus(book.id, 'EXTRACTED');

      expect(updated.status).toBe('EXTRACTED');
    });
  });

  describe('setCurrentSnapshot', () => {
    it('置 currentSnapshotId 且不刷新 updatedAt（P0-1 回归：避免 contentRevision 漂移死循环）', async () => {
      const book = await bookRepo.create({ title: 'Snap', filePath: '/tmp/s.txt', fileSize: 1, mimeType: 'text/plain', userId: testUser.id });
      const before = book.updatedAt;
      await new Promise((r) => setTimeout(r, 20));
      const snapshotId = randomUUID();
      await bookRepo.setCurrentSnapshot(book.id, snapshotId);
      const after = await bookRepo.findById(book.id);
      expect(after?.currentSnapshotId).toBe(snapshotId);
      expect(after?.updatedAt).toEqual(before);
    });

    it('传 null 清除 currentSnapshotId 且不刷新 updatedAt', async () => {
      const book = await bookRepo.create({ title: 'Snap2', filePath: '/tmp/s2.txt', fileSize: 1, mimeType: 'text/plain', userId: testUser.id });
      await bookRepo.setCurrentSnapshot(book.id, randomUUID());
      const before = (await bookRepo.findById(book.id))!.updatedAt;
      await new Promise((r) => setTimeout(r, 20));
      await bookRepo.setCurrentSnapshot(book.id, null);
      const after = await bookRepo.findById(book.id);
      expect(after?.currentSnapshotId).toBeNull();
      expect(after?.updatedAt).toEqual(before);
    });
  });

  describe('settleStatusAfterCancel（ISSUE-B4 方案 B）', () => {
    it('无已发布稳定结果：EXTRACTING 收敛为 UPLOADED', async () => {
      const book = await bookRepo.create({ title: 'Cancel No Result', filePath: '/tmp/c1.txt', fileSize: 1, mimeType: 'text/plain', userId: testUser.id });
      await bookRepo.updateStatus(book.id, 'EXTRACTING');

      await bookRepo.settleStatusAfterCancel(book.id);

      expect((await bookRepo.findById(book.id))?.status).toBe('UPLOADED');
    });

    it('有已发布稳定结果：EXTRACTING 收敛为 EXTRACTED', async () => {
      const book = await bookRepo.create({ title: 'Cancel With Result', filePath: '/tmp/c2.txt', fileSize: 1, mimeType: 'text/plain', userId: testUser.id });
      const session = await testPrisma.extractionSession.create({
        data: { bookId: book.id, userId: testUser.id, status: 'COMPLETED', promotedAt: new Date() },
      });
      await testPrisma.book.update({
        where: { id: book.id },
        data: { currentExtractionSessionId: session.id, status: 'EXTRACTING' },
      });

      await bookRepo.settleStatusAfterCancel(book.id);

      expect((await bookRepo.findById(book.id))?.status).toBe('EXTRACTED');
    });

    it('非 EXTRACTING 状态不改写（避免覆盖其他终态）', async () => {
      const book = await bookRepo.create({ title: 'Cancel Failed', filePath: '/tmp/c3.txt', fileSize: 1, mimeType: 'text/plain', userId: testUser.id });
      await bookRepo.updateStatus(book.id, 'FAILED');

      await bookRepo.settleStatusAfterCancel(book.id);

      expect((await bookRepo.findById(book.id))?.status).toBe('FAILED');
    });

    it('书籍不存在时静默返回', async () => {
      await expect(bookRepo.settleStatusAfterCancel(randomUUID())).resolves.toBeUndefined();
    });
  });

  describe('delete', () => {
    it('should delete a book by id', async () => {
      const book = await bookRepo.create({ title: 'To Delete', filePath: '/tmp/test.txt', fileSize: 1024, mimeType: 'text/plain', userId: testUser.id });
      await bookRepo.delete(book.id);

      const found = await bookRepo.findById(book.id);
      expect(found).toBeNull();
    });
  });
});
