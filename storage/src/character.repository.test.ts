import { describe, it, expect, beforeEach } from 'vitest';
import { createCharacterRepository, type CharacterRepository } from './character.repository.js';
import { createBookRepository, type BookRepository } from './book.repository.js';
import { createUserRepository, type UserRepository } from './user.repository.js';
import { testPrisma } from './test-setup.js';

describe('CharacterRepository', () => {
  let charRepo: CharacterRepository;
  let bookRepo: BookRepository;
  let userRepo: UserRepository;
  let testUser: { id: string; email: string; name: string };
  let testBook: { id: string; title: string; filePath: string; userId: string };

  beforeEach(async () => {
    charRepo = createCharacterRepository(testPrisma);
    bookRepo = createBookRepository(testPrisma);
    userRepo = createUserRepository(testPrisma);
    await testPrisma.character.deleteMany();
    await testPrisma.book.deleteMany();
    await testPrisma.user.deleteMany();
    testUser = await userRepo.create({ email: 'charuser@example.com', name: 'Char User' });
    testBook = await bookRepo.create({ title: 'Test Book', filePath: '/tmp/test.txt', fileSize: 1024, mimeType: 'text/plain', userId: testUser.id });
  });

  describe('create', () => {
    it('should create a character with required fields', async () => {
      const character = await charRepo.create({
        bookId: testBook.id,
        name: 'Sun Wukong',
        aliases: ['Monkey King', 'Great Sage Equal to Heaven'],
        confidence: 0.95,
      });

      expect(character.name).toBe('Sun Wukong');
      expect(character.bookId).toBe(testBook.id);
      expect(character.aliases).toEqual(['Monkey King', 'Great Sage Equal to Heaven']);
      expect(character.confidence).toBe(0.95);
      expect(character.status).toBe('PENDING');
    });

    it('should create a character with optional description and chapterRef', async () => {
      const character = await charRepo.create({
        bookId: testBook.id,
        name: 'Tripitaka',
        aliases: ['Xuanzang'],
        description: 'A Buddhist monk',
        chapterRef: 'Chapter 1',
        confidence: 0.85,
      });

      expect(character.description).toBe('A Buddhist monk');
      expect(character.chapterRef).toBe('Chapter 1');
    });

    it('should create a character with importance evaluation fields', async () => {
      const character = await charRepo.create({
        bookId: testBook.id,
        name: 'Gandalf',
        aliases: ['Mithrandir', 'The Grey'],
        description: 'A powerful wizard',
        confidence: 0.95,
        firstChapter: 1,
        lastChapter: 22,
        chapterAppearances: [1, 3, 5, 8, 12, 15, 18, 22],
        mentionCount: 150,
        dialogueCount: 45,
      });

      expect(character.firstChapter).toBe(1);
      expect(character.lastChapter).toBe(22);
      expect(character.chapterAppearances).toEqual([1, 3, 5, 8, 12, 15, 18, 22]);
      expect(character.mentionCount).toBe(150);
      expect(character.dialogueCount).toBe(45);
    });

    it('should generate unique ids for each character', async () => {
      const char1 = await charRepo.create({ bookId: testBook.id, name: 'Char 1', aliases: [], confidence: 0.5 });
      const char2 = await charRepo.create({ bookId: testBook.id, name: 'Char 2', aliases: [], confidence: 0.5 });

      expect(char1.id).not.toBe(char2.id);
    });
  });

  describe('createMany', () => {
    it('should create multiple characters at once', async () => {
      const count = await charRepo.createMany([
        { bookId: testBook.id, name: 'Character 1', aliases: ['alias1'], confidence: 0.9 },
        { bookId: testBook.id, name: 'Character 2', aliases: ['alias2'], confidence: 0.8 },
        { bookId: testBook.id, name: 'Character 3', aliases: [], confidence: 0.7 },
      ]);

      expect(count).toBe(3);
    });

    it('should create multiple characters with importance fields', async () => {
      const count = await charRepo.createMany([
        {
          bookId: testBook.id,
          name: 'Frodo',
          aliases: ['Ringbearer'],
          confidence: 0.95,
          firstChapter: 1,
          lastChapter: 24,
          chapterAppearances: [1, 2, 5, 10, 15, 20, 24],
          mentionCount: 200,
          dialogueCount: 60,
        },
        {
          bookId: testBook.id,
          name: 'Sam',
          aliases: ['Samwise'],
          confidence: 0.92,
          firstChapter: 1,
          lastChapter: 24,
          chapterAppearances: [1, 2, 5, 10, 15, 20, 24],
          mentionCount: 180,
          dialogueCount: 55,
        },
      ]);

      expect(count).toBe(2);
    });
  });

  describe('findByBookId', () => {
    it('should find all characters for a book', async () => {
      await charRepo.create({ bookId: testBook.id, name: 'Char 1', aliases: [], confidence: 0.5 });
      await charRepo.create({ bookId: testBook.id, name: 'Char 2', aliases: [], confidence: 0.6 });

      const characters = await charRepo.findByBookId(testBook.id);

      expect(characters).toHaveLength(2);
    });

    it('should return empty array when no characters exist for book', async () => {
      const characters = await charRepo.findByBookId(testBook.id);
      expect(characters).toHaveLength(0);
    });

    it('should parse aliases from JSON string', async () => {
      await charRepo.create({ bookId: testBook.id, name: 'Test', aliases: ['a', 'b'], confidence: 0.5 });

      const characters = await charRepo.findByBookId(testBook.id);

      expect(characters[0].aliases).toEqual(['a', 'b']);
    });

    it('should parse chapterAppearances from JSON string', async () => {
      await charRepo.create({
        bookId: testBook.id,
        name: 'Test',
        aliases: [],
        confidence: 0.5,
        firstChapter: 3,
        lastChapter: 15,
        chapterAppearances: [3, 5, 7, 10, 15],
        mentionCount: 50,
        dialogueCount: 10,
      });

      const characters = await charRepo.findByBookId(testBook.id);

      expect(characters[0].chapterAppearances).toEqual([3, 5, 7, 10, 15]);
      expect(characters[0].firstChapter).toBe(3);
      expect(characters[0].lastChapter).toBe(15);
      expect(characters[0].mentionCount).toBe(50);
      expect(characters[0].dialogueCount).toBe(10);
    });

    it('should return characters ordered by createdAt ascending', async () => {
      await charRepo.create({ bookId: testBook.id, name: 'First', aliases: [], confidence: 0.5 });
      await charRepo.create({ bookId: testBook.id, name: 'Second', aliases: [], confidence: 0.5 });

      const characters = await charRepo.findByBookId(testBook.id);

      expect(characters[0].name).toBe('First');
      expect(characters[1].name).toBe('Second');
    });
  });

  describe('findById', () => {
    it('should find a character by id', async () => {
      const created = await charRepo.create({ bookId: testBook.id, name: 'Find Me', aliases: [], confidence: 0.5 });
      const found = await charRepo.findById(created.id);

      expect(found).not.toBeNull();
      expect(found?.name).toBe('Find Me');
    });

    it('should return null when character does not exist', async () => {
      const found = await charRepo.findById('non-existent-id');
      expect(found).toBeNull();
    });
  });

  describe('findByStatus', () => {
    it('should find characters by status', async () => {
      const char1 = await charRepo.create({ bookId: testBook.id, name: 'Pending 1', aliases: [], confidence: 0.5 });
      await charRepo.create({ bookId: testBook.id, name: 'Pending 2', aliases: [], confidence: 0.5 });
      await charRepo.updateStatus(char1.id, 'APPROVED');

      const pending = await charRepo.findByStatus(testBook.id, 'PENDING');
      const approved = await charRepo.findByStatus(testBook.id, 'APPROVED');

      expect(pending).toHaveLength(1);
      expect(pending[0].name).toBe('Pending 2');
      expect(approved).toHaveLength(1);
      expect(approved[0].name).toBe('Pending 1');
    });
  });

  describe('update', () => {
    it('should update character fields', async () => {
      const character = await charRepo.create({ bookId: testBook.id, name: 'Original', aliases: [], confidence: 0.5 });

      const updated = await charRepo.update(character.id, {
        name: 'Updated',
        description: 'New description',
        confidence: 0.9,
      });

      expect(updated.name).toBe('Updated');
      expect(updated.description).toBe('New description');
      expect(updated.confidence).toBe(0.9);
    });

    it('should stringify aliases when updating', async () => {
      const character = await charRepo.create({ bookId: testBook.id, name: 'Test', aliases: [], confidence: 0.5 });

      const updated = await charRepo.update(character.id, { aliases: ['new', 'aliases'] });
      const found = await charRepo.findById(character.id);

      expect(found?.aliases).toEqual(['new', 'aliases']);
    });
  });

  describe('updateStatus', () => {
    it('should update character status to APPROVED', async () => {
      const character = await charRepo.create({ bookId: testBook.id, name: 'Test', aliases: [], confidence: 0.5 });

      const updated = await charRepo.updateStatus(character.id, 'APPROVED');

      expect(updated.status).toBe('APPROVED');
    });

    it('should update character status to REJECTED', async () => {
      const character = await charRepo.create({ bookId: testBook.id, name: 'Test', aliases: [], confidence: 0.5 });

      const updated = await charRepo.updateStatus(character.id, 'REJECTED');

      expect(updated.status).toBe('REJECTED');
    });
  });

  describe('deleteByBookId', () => {
    it('should delete all characters for a book', async () => {
      await charRepo.create({ bookId: testBook.id, name: 'Char 1', aliases: [], confidence: 0.5 });
      await charRepo.create({ bookId: testBook.id, name: 'Char 2', aliases: [], confidence: 0.5 });

      await charRepo.deleteByBookId(testBook.id);

      const characters = await charRepo.findByBookId(testBook.id);
      expect(characters).toHaveLength(0);
    });
  });
});
