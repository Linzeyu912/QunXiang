import { describe, it, expect, beforeEach } from 'vitest';
import { createUserRepository, type UserRepository } from './user.repository.js';
import { testPrisma } from './test-setup.js';

describe('UserRepository', () => {
  let repo: UserRepository;

  beforeEach(async () => {
    repo = createUserRepository(testPrisma);
    await testPrisma.user.deleteMany();
  });

  describe('create', () => {
    it('should create a user with email and name', async () => {
      const user = await repo.create({ email: 'test@example.com', name: 'Test User' });

      expect(user.email).toBe('test@example.com');
      expect(user.name).toBe('Test User');
      expect(user.id).toBeDefined();
      expect(user.createdAt).toBeInstanceOf(Date);
    });

    it('should generate a unique id for each user', async () => {
      const user1 = await repo.create({ email: 'user1@example.com', name: 'User 1' });
      const user2 = await repo.create({ email: 'user2@example.com', name: 'User 2' });

      expect(user1.id).not.toBe(user2.id);
    });
  });

  describe('findById', () => {
    it('should find a user by id', async () => {
      const created = await repo.create({ email: 'find@example.com', name: 'Find Me' });
      const found = await repo.findById(created.id);

      expect(found).not.toBeNull();
      expect(found?.email).toBe('find@example.com');
    });

    it('should return null when user does not exist', async () => {
      const found = await repo.findById('non-existent-id');
      expect(found).toBeNull();
    });
  });

  describe('findByEmail', () => {
    it('should find a user by email', async () => {
      await repo.create({ email: 'unique@example.com', name: 'Unique User' });
      const found = await repo.findByEmail('unique@example.com');

      expect(found).not.toBeNull();
      expect(found?.name).toBe('Unique User');
    });

    it('should return null when email does not exist', async () => {
      const found = await repo.findByEmail('nonexistent@example.com');
      expect(found).toBeNull();
    });
  });

  describe('findOrCreate', () => {
    it('should find existing user by email', async () => {
      const created = await repo.create({ email: 'existing@example.com', name: 'Existing' });
      const result = await repo.findOrCreate({ email: 'existing@example.com', name: 'Should Not Overwrite' });

      expect(result.id).toBe(created.id);
      expect(result.name).toBe('Existing');
    });

    it('should create new user when email does not exist', async () => {
      const result = await repo.findOrCreate({ email: 'new@example.com', name: 'New User' });

      expect(result.email).toBe('new@example.com');
      expect(result.name).toBe('New User');
    });
  });
});
