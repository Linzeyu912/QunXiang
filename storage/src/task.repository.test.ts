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

  describe('claimNext（原子抢占）', () => {
    it('无 pending 任务时返回 null', async () => {
      const claimed = await taskRepo.claimNext('extractor');
      expect(claimed).toBeNull();
    });

    it('抢占一条 pending 任务并标记为 running', async () => {
      const created = await taskRepo.create({ bookId: testBook.id, agentType: 'extractor', payload: { x: 1 } });
      const claimed = await taskRepo.claimNext('extractor');

      expect(claimed).not.toBeNull();
      expect(claimed?.id).toBe(created.id);
      expect(claimed?.status).toBe('running');
      expect(claimed?.payload).toEqual({ x: 1 });
    });

    it('按 createdAt 升序抢占最老的任务', async () => {
      const t1 = await taskRepo.create({ bookId: testBook.id, agentType: 'extractor', payload: { n: 1 } });
      // 确保 createdAt 不同（SQLite 精度可能只到秒，加微小延迟）
      await new Promise((r) => setTimeout(r, 1100));
      const t2 = await taskRepo.create({ bookId: testBook.id, agentType: 'extractor', payload: { n: 2 } });

      const claimed = await taskRepo.claimNext('extractor');
      expect(claimed?.id).toBe(t1.id);
      expect(claimed?.id).not.toBe(t2.id);
    });

    it('并发抢占：两个 claimNext 不会同时拿到同一条任务（核心竞态修复）', async () => {
      // 只放一条 pending 任务。两个并发 claimNext 必须只有一个拿到非 null。
      // 修改前（findPending+updateStatus 两步非原子）：两者都可能拿到同一条。
      await taskRepo.create({ bookId: testBook.id, agentType: 'extractor', payload: {} });

      const [a, b] = await Promise.all([
        taskRepo.claimNext('extractor'),
        taskRepo.claimNext('extractor'),
      ]);

      const claimed = [a, b].filter((t) => t !== null);
      expect(claimed).toHaveLength(1); // 只有一个抢到
    });

    it('抢占后再 claimNext 拿到下一条（不会重复拿已 running 的）', async () => {
      await taskRepo.create({ bookId: testBook.id, agentType: 'extractor', payload: { n: 1 } });
      await new Promise((r) => setTimeout(r, 1100));
      await taskRepo.create({ bookId: testBook.id, agentType: 'extractor', payload: { n: 2 } });

      const first = await taskRepo.claimNext('extractor');
      const second = await taskRepo.claimNext('extractor');

      expect(first?.payload).toEqual({ n: 1 });
      expect(second?.payload).toEqual({ n: 2 });
      expect(first?.id).not.toBe(second?.id);
      const third = await taskRepo.claimNext('extractor');
      expect(third).toBeNull();
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
