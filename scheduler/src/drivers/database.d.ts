import type { Task, AgentType } from '@novel-agent/core';
import type { TaskQueue } from '../task-queue.js';
/**
 * Database-backed TaskQueue implementation
 * Persists tasks to SQLite via Prisma
 */
export declare class DatabaseTaskQueue implements TaskQueue {
    enqueue(task: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>): Promise<string>;
    dequeue(agentType: AgentType): Promise<Task | null>;
    complete(taskId: string, result: unknown): Promise<void>;
    fail(taskId: string, error: string): Promise<void>;
    getStatus(taskId: string): Promise<Task | null>;
    getPending(agentType: AgentType): Promise<Task[]>;
    addToDeadLetter(taskId: string, error: string, retryCount: number): Promise<void>;
    findStuckTasks(thresholdMs: number): Promise<Task[]>;
    recoverStuckTask(taskId: string): Promise<void>;
}
//# sourceMappingURL=database.d.ts.map