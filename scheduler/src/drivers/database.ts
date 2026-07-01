import type { Task, AgentType } from '@novel-agent/core';
import type { TaskQueue } from '../task-queue.js';
import { TaskRepository } from '@novel-agent/storage';

/**
 * Database-backed TaskQueue implementation
 * Persists tasks to SQLite via Prisma
 */
export class DatabaseTaskQueue implements TaskQueue {
  async enqueue(task: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
    const created = await TaskRepository.create({
      bookId: task.bookId,
      agentType: task.agentType,
      payload: task.payload,
      status: task.status,
    });
    return created.id;
  }

  async dequeue(agentType: AgentType): Promise<Task | null> {
    // Get oldest pending task (FIFO)
    const pending = await TaskRepository.findPending(agentType);
    if (pending.length === 0) {
      return null;
    }

    const task = pending[0];

    // Mark as running
    await TaskRepository.updateStatus(task.id, 'running');
    task.status = 'running';

    return task;
  }

  async complete(taskId: string, result: unknown): Promise<void> {
    await TaskRepository.updateStatus(taskId, 'completed', result);
  }

  async fail(taskId: string, error: string): Promise<void> {
    await TaskRepository.updateStatus(taskId, 'failed', undefined, error);
  }

  async getStatus(taskId: string): Promise<Task | null> {
    return TaskRepository.findById(taskId);
  }

  async getPending(agentType: AgentType): Promise<Task[]> {
    return TaskRepository.findAllPending(agentType);
  }

  async addToDeadLetter(taskId: string, error: string, retryCount: number): Promise<void> {
    await TaskRepository.markAsDeadLetter(taskId, error, retryCount);
  }

  async findStuckTasks(thresholdMs: number): Promise<Task[]> {
    return TaskRepository.findStuckTasks(thresholdMs);
  }

  async recoverStuckTask(taskId: string): Promise<void> {
    await TaskRepository.recoverStuckTask(taskId);
  }
}
