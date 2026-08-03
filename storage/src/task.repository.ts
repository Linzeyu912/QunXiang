import { prisma } from './prisma.js';
import type { Task, AgentType } from '@novel-agent/core';
import { Prisma, type PrismaClient } from '@prisma/client';
import { decodeJsonField, encodeJsonField } from './json-field.js';

export interface TaskRepository {
  create(data: {
    bookId: string;
    agentType: AgentType;
    payload: unknown;
    status?: string;
    result?: unknown;
    error?: string;
  }): Promise<Task>;
  findById(id: string): Promise<Task | null>;
  findOwnedById(id: string, ownerId: string): Promise<Task | null>;
  updateStatus(id: string, status: string, result?: unknown, error?: string): Promise<Task>;
  updateOwnedStatus(id: string, ownerId: string, status: string, result?: unknown, error?: string): Promise<Task | null>;
  findPending(agentType: AgentType): Promise<Task[]>;
  /**
   * 原子抢占一条 pending 任务：把最老的 pending 标记为 running 并返回。
   * 用带 status:'pending' 条件的 updateMany 保证多 worker 并发时只有一个抢成功
   *（count===1 即抢到；被别人先抢走则 count===0 返回 null）。
   * 修复旧 dequeue 的 findPending + updateStatus 两步非原子竞态（多 worker 抢同一任务）。
   */
  claimNext(agentType: AgentType): Promise<Task | null>;
  findByBookId(bookId: string): Promise<Task[]>;
  findByOwnedBookId(bookId: string, ownerId: string): Promise<Task[]>;
  /** 删除该书全部任务记录——重新提取前清掉上一轮遗留，避免 getExtractionStages 读到旧状态。 */
  deleteByBookId(bookId: string): Promise<void>;
  deleteOwnedByBookId(bookId: string, ownerId: string): Promise<boolean>;
  findAllPending(agentType: AgentType): Promise<Task[]>;
  markAsDeadLetter(taskId: string, error: string, retryCount: number): Promise<Task>;
  findStuckTasks(thresholdMs: number): Promise<Task[]>;
  recoverStuckTask(taskId: string): Promise<Task>;
  incrementRetryCount(taskId: string): Promise<Task>;
}

function parseTask(task: Record<string, unknown>): Task {
  return {
    ...task,
    agentType: task.agentType as AgentType,
    status: task.status as Task['status'],
    error: (task.error as string | null) ?? undefined,
    failedAt: (task.failedAt as Date | null) ?? undefined,
    payload: decodeJsonField(task.payload, {}),
    result: decodeJsonField(task.result, undefined),
  } as Task;
}

export function createTaskRepository(db: PrismaClient): TaskRepository {
  return {
    async create(data: {
      bookId: string;
      agentType: AgentType;
      payload: unknown;
      status?: string;
      result?: unknown;
      error?: string;
    }): Promise<Task> {
      const created = await db.task.create({
        data: {
          bookId: data.bookId,
          agentType: data.agentType,
          payload: encodeJsonField(data.payload),
          status: data.status || 'pending',
          result: data.result ? encodeJsonField(data.result) : undefined,
          error: data.error,
        },
      });
      return parseTask(created as unknown as Record<string, unknown>);
    },

    async findById(id: string): Promise<Task | null> {
      const task = await db.task.findUnique({ where: { id } });
      if (!task) return null;
      return parseTask(task as unknown as Record<string, unknown>);
    },

    async findOwnedById(id: string, ownerId: string): Promise<Task | null> {
      const task = await db.task.findFirst({ where: { id, book: { userId: ownerId } } });
      return task ? parseTask(task as unknown as Record<string, unknown>) : null;
    },

    async updateStatus(
      id: string,
      status: string,
      result?: unknown,
      error?: string
    ): Promise<Task> {
      const updated = await db.task.update({
        where: { id },
        data: {
          status,
          result: result === undefined
            ? undefined
            : result === null
              ? Prisma.JsonNull
              : encodeJsonField(result),
          error,
        },
      });
      return parseTask(updated as unknown as Record<string, unknown>);
    },

    async updateOwnedStatus(id, ownerId, status, result, error): Promise<Task | null> {
      const update = await db.task.updateMany({
        where: { id, book: { userId: ownerId } },
        data: {
          status,
          result: result === undefined ? undefined : result === null ? Prisma.JsonNull : encodeJsonField(result),
          error,
        },
      });
      if (update.count !== 1) return null;
      const task = await db.task.findFirst({ where: { id, book: { userId: ownerId } } });
      return task ? parseTask(task as unknown as Record<string, unknown>) : null;
    },

    async findPending(agentType: AgentType): Promise<Task[]> {
      const tasks = await db.task.findMany({
        where: { agentType, status: 'pending' },
        orderBy: { createdAt: 'asc' },
        take: 1,
      });
      return tasks.map(task => parseTask(task as unknown as Record<string, unknown>));
    },

    async claimNext(agentType: AgentType): Promise<Task | null> {
      // 1. 取最老的一条 pending（仅读 id，不依赖其后续状态）
      const pending = await db.task.findFirst({
        where: { agentType, status: 'pending' },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      if (!pending) return null;

      // 2. 原子抢占：只有当该任务仍为 pending 时才改为 running。
      //    并发的另一 worker 若先抢，这里 status 已是 running，count===0。
      const result = await db.task.updateMany({
        where: { id: pending.id, status: 'pending' },
        data: { status: 'running' },
      });
      if (result.count === 0) {
        // 被别的 worker 抢走了；调用方应再次轮询。这里返回 null 表示本次无任务可处理。
        return null;
      }

      // 3. 抢到，读回完整行（含 payload）
      const task = await db.task.findUnique({ where: { id: pending.id } });
      if (!task) return null;
      return parseTask(task as unknown as Record<string, unknown>);
    },

    async findByBookId(bookId: string): Promise<Task[]> {
      const tasks = await db.task.findMany({
        where: { bookId },
        orderBy: { createdAt: 'asc' },
      });
      return tasks.map(task => parseTask(task as unknown as Record<string, unknown>));
    },

    async deleteByBookId(bookId: string): Promise<void> {
      await db.task.deleteMany({ where: { bookId } });
    },

    async findByOwnedBookId(bookId: string, ownerId: string): Promise<Task[]> {
      const tasks = await db.task.findMany({
        where: { bookId, book: { userId: ownerId } },
        orderBy: { createdAt: 'asc' },
      });
      return tasks.map(task => parseTask(task as unknown as Record<string, unknown>));
    },

    async deleteOwnedByBookId(bookId: string, ownerId: string): Promise<boolean> {
      const result = await db.task.deleteMany({ where: { bookId, book: { userId: ownerId } } });
      return result.count > 0;
    },

    async findAllPending(agentType: AgentType): Promise<Task[]> {
      const tasks = await db.task.findMany({
        where: { agentType, status: 'pending' },
        orderBy: { createdAt: 'asc' },
      });
      return tasks.map(task => parseTask(task as unknown as Record<string, unknown>));
    },

    async markAsDeadLetter(
      taskId: string,
      error: string,
      retryCount: number
    ): Promise<Task> {
      return db.task.update({
        where: { id: taskId },
        data: {
          status: 'dead_lettered',
          error,
          retryCount,
          deadLettered: true,
          failedAt: new Date(),
        },
      }) as Promise<Task>;
    },

    async findStuckTasks(thresholdMs: number): Promise<Task[]> {
      const cutoff = new Date(Date.now() - thresholdMs);
      const tasks = await db.task.findMany({
        where: {
          status: 'running',
          updatedAt: { lt: cutoff },
        },
      });
      return tasks.map(task => parseTask(task as unknown as Record<string, unknown>));
    },

    async recoverStuckTask(taskId: string): Promise<Task> {
      return db.task.update({
        where: { id: taskId },
        data: {
          status: 'pending',
          error: null,
          deadLettered: false,
          failedAt: null,
        },
      }) as Promise<Task>;
    },

    async incrementRetryCount(taskId: string): Promise<Task> {
      const task = await db.task.findUnique({ where: { id: taskId } });
      if (!task) {
        throw new Error(`任务不存在：${taskId}`);
      }
      return db.task.update({
        where: { id: taskId },
        data: {
          retryCount: task.retryCount + 1,
        },
      }) as Promise<Task>;
    },
  };
}

export const TaskRepository = createTaskRepository(prisma);
