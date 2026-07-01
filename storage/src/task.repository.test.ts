import { describe, it, expect, beforeEach } from 'vitest';
import { createTaskRepository, type TaskRepository } from './task.repository.js';
import { createBookRepository, type BookRepository } from './book.repository.js';
import { createUserRepository, type UserRepository } from './user.repository.js';
import { testPrisma } from './test-setup.js';

describe('TaskRepository', () => {
  let taskRepo: TaskRepository;
  let bookRepo: BookRepository;
  let userRepo: UserRepository;
  let testUser: { id: string; email: string; name: string };
  let testBook: { id: string; title: string; filePath: string; userId: string };

  beforeEach(async () => {
    taskRepo = createTaskRepository(testPrisma);
    bookRepo = createBookRepository(testPrisma);
    userRepo = createUserRepository(testPrisma);
    await testPrisma.task.deleteMany();
    await testPrisma.book.deleteMany();
    await testPrisma.user.deleteMany();
    testUser = await userRepo.create({ email: 'taskuser@example.com', name: 'Task User' });
    testBook = await bookRepo.create({ title: 'Task Book', filePath: '/tmp/test.txt', fileSize: 1024, mimeType: 'text/plain', userId: testUser.id });
  });

  describe('create', () => {
    it('should create a task with bookId, agentType, and payload', async () => {
      const task = await taskRepo.create({
        bookId: testBook.id,
        agentType: 'extractor',
        payload: { fileId: 'file-123' },
      });

      expect(task.bookId).toBe(testBook.id);
      expect(task.agentType).toBe('extractor');
      expect(task.status).toBe('pending');
      expect(task.payload).toEqual({ fileId: 'file-123' });
    });

    it('should default status to pending', async () => {
      const task = await taskRepo.create({
        bookId: testBook.id,
        agentType: 'validator',
        payload: {},
      });

      expect(task.status).toBe('pending');
    });

    it('should generate unique ids for each task', async () => {
      const task1 = await taskRepo.create({ bookId: testBook.id, agentType: 'extractor', payload: {} });
      const task2 = await taskRepo.create({ bookId: testBook.id, agentType: 'validator', payload: {} });

      expect(task1.id).not.toBe(task2.id);
    });
  });

  describe('findById', () => {
    it('should find a task by id', async () => {
      const created = await taskRepo.create({ bookId: testBook.id, agentType: 'extractor', payload: {} });
      const found = await taskRepo.findById(created.id);

      expect(found).not.toBeNull();
      expect(found?.agentType).toBe('extractor');
    });

    it('should return null when task does not exist', async () => {
      const found = await taskRepo.findById('non-existent-id');
      expect(found).toBeNull();
    });

    it('should parse payload from JSON string', async () => {
      const created = await taskRepo.create({
        bookId: testBook.id,
        agentType: 'reviewer',
        payload: { characters: ['a', 'b'] },
      });

      const found = await taskRepo.findById(created.id);

      expect(found?.payload).toEqual({ characters: ['a', 'b'] });
    });
  });

  describe('updateStatus', () => {
    it('should update task status to running', async () => {
      const task = await taskRepo.create({ bookId: testBook.id, agentType: 'extractor', payload: {} });

      const updated = await taskRepo.updateStatus(task.id, 'running');

      expect(updated.status).toBe('running');
    });

    it('should update task status to completed with result', async () => {
      const task = await taskRepo.create({ bookId: testBook.id, agentType: 'reviewer', payload: {} });
      const result = { characters: [{ name: 'Test' }] };

      const updated = await taskRepo.updateStatus(task.id, 'completed', result);

      expect(updated.status).toBe('completed');
      expect(updated.result).toEqual(result);
    });

    it('should update task status to failed with error', async () => {
      const task = await taskRepo.create({ bookId: testBook.id, agentType: 'extractor', payload: {} });

      const updated = await taskRepo.updateStatus(task.id, 'failed', undefined, 'Network error');

      expect(updated.status).toBe('failed');
      expect(updated.error).toBe('Network error');
    });
  });

  describe('findPending', () => {
    it('should find one pending task by agentType', async () => {
      await taskRepo.create({ bookId: testBook.id, agentType: 'extractor', payload: {} });
      await taskRepo.create({ bookId: testBook.id, agentType: 'extractor', payload: {} });

      const pending = await taskRepo.findPending('extractor');

      expect(pending).toHaveLength(1);
    });

    it('should return empty array when no pending tasks', async () => {
      const pending = await taskRepo.findPending('reviewer');
      expect(pending).toHaveLength(0);
    });

    it('should return tasks ordered by createdAt ascending', async () => {
      await taskRepo.create({ bookId: testBook.id, agentType: 'validator', payload: {} });
      await taskRepo.create({ bookId: testBook.id, agentType: 'validator', payload: {} });

      const pending = await taskRepo.findAllPending('validator');

      expect(pending).toHaveLength(2);
    });
  });

  describe('findByBookId', () => {
    it('should find all tasks for a book', async () => {
      await taskRepo.create({ bookId: testBook.id, agentType: 'extractor', payload: {} });
      await taskRepo.create({ bookId: testBook.id, agentType: 'validator', payload: {} });
      await taskRepo.create({ bookId: testBook.id, agentType: 'reviewer', payload: {} });

      const tasks = await taskRepo.findByBookId(testBook.id);

      expect(tasks).toHaveLength(3);
    });

    it('should return tasks ordered by createdAt ascending', async () => {
      await taskRepo.create({ bookId: testBook.id, agentType: 'extractor', payload: {} });
      await taskRepo.create({ bookId: testBook.id, agentType: 'validator', payload: {} });

      const tasks = await taskRepo.findByBookId(testBook.id);

      expect(tasks[0].agentType).toBe('extractor');
      expect(tasks[1].agentType).toBe('validator');
    });
  });

  describe('findAllPending', () => {
    it('should find all pending tasks by agentType', async () => {
      await taskRepo.create({ bookId: testBook.id, agentType: 'extractor', payload: {} });
      await taskRepo.create({ bookId: testBook.id, agentType: 'extractor', payload: {} });

      const pending = await taskRepo.findAllPending('extractor');

      expect(pending).toHaveLength(2);
    });
  });

  describe('markAsDeadLetter', () => {
    it('should mark task as dead lettered with error and retry count', async () => {
      const task = await taskRepo.create({ bookId: testBook.id, agentType: 'extractor', payload: {} });

      const updated = await taskRepo.markAsDeadLetter(task.id, 'Max retries exceeded', 3);

      expect(updated.status).toBe('dead_lettered');
      expect(updated.error).toBe('Max retries exceeded');
      expect(updated.retryCount).toBe(3);
      expect(updated.deadLettered).toBe(true);
      expect(updated.failedAt).toBeInstanceOf(Date);
    });
  });

  describe('findStuckTasks', () => {
    it('should find tasks running longer than threshold', async () => {
      const task = await taskRepo.create({ bookId: testBook.id, agentType: 'extractor', payload: {} });
      await taskRepo.updateStatus(task.id, 'running');

      // Task has just been marked running, should not be stuck with 100ms threshold
      const stuck = await taskRepo.findStuckTasks(100);
      expect(stuck).toHaveLength(0);
    });
  });

  describe('recoverStuckTask', () => {
    it('should recover a stuck task to pending', async () => {
      const task = await taskRepo.create({ bookId: testBook.id, agentType: 'extractor', payload: {} });
      await taskRepo.updateStatus(task.id, 'running');

      const recovered = await taskRepo.recoverStuckTask(task.id);

      expect(recovered.status).toBe('pending');
      expect(recovered.error).toBeNull();
      expect(recovered.deadLettered).toBe(false);
    });
  });

  describe('incrementRetryCount', () => {
    it('should increment retry count', async () => {
      const task = await taskRepo.create({ bookId: testBook.id, agentType: 'extractor', payload: {} });

      const updated = await taskRepo.incrementRetryCount(task.id);

      expect(updated.retryCount).toBe(1);
    });

    it('should throw error when task not found', async () => {
      await expect(taskRepo.incrementRetryCount('non-existent')).rejects.toThrow('Task not found');
    });
  });
});
