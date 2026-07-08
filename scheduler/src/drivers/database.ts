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
    // 原子抢占：claimNext 用带 status:'pending' 条件的 updateMany，
    // 保证多 worker 并发时只有一个抢到同一任务（修复旧 findPending+updateStatus
    // 两步非原子竞态——两个 worker 会读到同一条 pending 并各自标 running）。
    return TaskRepository.claimNext(agentType);
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
