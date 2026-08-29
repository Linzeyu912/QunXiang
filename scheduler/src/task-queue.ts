import type { Task, AgentType } from '@qunxiang/core';

export interface TaskQueue {
  enqueue(task: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>): Promise<string>;
  dequeue(agentType: AgentType): Promise<Task | null>;
  complete(taskId: string, result: unknown): Promise<void>;
  fail(taskId: string, error: string): Promise<void>;
  /** 任务心跳：agent 执行期间定期刷新，防长阶段被超时回收误判卡死。 */
  heartbeat(taskId: string): Promise<void>;
  getStatus(taskId: string): Promise<Task | null>;
  getPending(agentType: AgentType): Promise<Task[]>;
  addToDeadLetter(taskId: string, error: string, retryCount: number): Promise<void>;
  findStuckTasks(thresholdMs: number): Promise<Task[]>;
  recoverStuckTask(taskId: string): Promise<void>;
}
