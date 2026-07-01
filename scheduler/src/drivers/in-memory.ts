import type { Task, AgentType } from '@novel-agent/core';
import type { TaskQueue } from '../task-queue.js';

export class InMemoryTaskQueue implements TaskQueue {
  private tasks: Map<string, Task> = new Map();
  private pendingByAgent: Map<AgentType, string[]> = new Map();

  async enqueue(task: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
    const id = crypto.randomUUID();
    const now = new Date();
    const fullTask: Task = {
      ...task,
      id,
      createdAt: now,
      updatedAt: now,
    };

    this.tasks.set(id, fullTask);

    const pending = this.pendingByAgent.get(task.agentType) || [];
    pending.push(id);
    this.pendingByAgent.set(task.agentType, pending);

    return id;
  }

  async dequeue(agentType: AgentType): Promise<Task | null> {
    const pending = this.pendingByAgent.get(agentType) || [];
    if (pending.length === 0) return null;

    const taskId = pending.shift()!;
    const task = this.tasks.get(taskId);
    if (!task) return null;

    task.status = 'running';
    task.updatedAt = new Date();
    this.tasks.set(taskId, task);

    return task;
  }

  async complete(taskId: string, result: unknown): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.status = 'completed';
    task.result = result;
    task.updatedAt = new Date();
    this.tasks.set(taskId, task);

    // Remove from pending
    const pending = this.pendingByAgent.get(task.agentType) || [];
    const index = pending.indexOf(taskId);
    if (index > -1) pending.splice(index, 1);
  }

  async fail(taskId: string, error: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.status = 'failed';
    task.error = error;
    task.updatedAt = new Date();
    this.tasks.set(taskId, task);

    // Remove from pending
    const pending = this.pendingByAgent.get(task.agentType) || [];
    const index = pending.indexOf(taskId);
    if (index > -1) pending.splice(index, 1);
  }

  async getStatus(taskId: string): Promise<Task | null> {
    return this.tasks.get(taskId) || null;
  }

  async getPending(agentType: AgentType): Promise<Task[]> {
    const pending = this.pendingByAgent.get(agentType) || [];
    return pending
      .map(id => this.tasks.get(id))
      .filter((t): t is Task => t !== undefined && t.status === 'pending');
  }

  async addToDeadLetter(taskId: string, error: string, retryCount: number): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.status = 'dead_lettered';
    task.error = error;
    task.retryCount = retryCount;
    task.deadLettered = true;
    task.failedAt = new Date();
    task.updatedAt = new Date();
    this.tasks.set(taskId, task);

    // Remove from pending
    const pending = this.pendingByAgent.get(task.agentType) || [];
    const index = pending.indexOf(taskId);
    if (index > -1) pending.splice(index, 1);
  }

  async findStuckTasks(thresholdMs: number): Promise<Task[]> {
    const cutoff = new Date(Date.now() - thresholdMs);
    const stuck: Task[] = [];
    for (const task of this.tasks.values()) {
      if (task.status === 'running' && task.updatedAt < cutoff) {
        stuck.push(task);
      }
    }
    return stuck;
  }

  async recoverStuckTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.status = 'pending';
    task.error = undefined;
    task.deadLettered = false;
    task.failedAt = undefined;
    task.updatedAt = new Date();
    this.tasks.set(taskId, task);

    // Re-add to pending queue
    const pending = this.pendingByAgent.get(task.agentType) || [];
    if (!pending.includes(taskId)) {
      pending.unshift(taskId);
      this.pendingByAgent.set(task.agentType, pending);
    }
  }
}
