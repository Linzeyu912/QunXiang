import { describe, it, expect, beforeEach } from 'vitest';
import { createBookRepository, type BookRepository } from './book.repository.js';
import { createUserRepository, type UserRepository } from './user.repository.js';
import { testPrisma } from './test-setup.js';

describe('BookRepository', () => {
  let bookRepo: BookRepository;
  let userRepo: UserRepository;
  let testUser: { id: string; email: string; name: string };

  beforeEach(async () => {
    bookRepo = createBookRepository(testPrisma);
    userRepo = createUserRepository(testPrisma);
    await testPrisma.book.deleteMany();
    await testPrisma.user.deleteMany();
    testUser = await userRepo.create({ email: 'bookuser@example.com', name: 'Book User' });
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
      const found = await bookRepo.findById('non-existent-id');
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
      const otherUser = await userRepo.create({ email: 'other@example.com', name: 'Other User' });
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

  describe('delete', () => {
    it('should delete a book by id', async () => {
      const book = await bookRepo.create({ title: 'To Delete', filePath: '/tmp/test.txt', fileSize: 1024, mimeType: 'text/plain', userId: testUser.id });
      await bookRepo.delete(book.id);

      const found = await bookRepo.findById(book.id);
      expect(found).toBeNull();
    });
  });
});
