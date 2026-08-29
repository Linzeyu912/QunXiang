import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskDispatcher, mergeResumeStageResults } from './dispatcher.js';
import type { TaskQueue } from './task-queue.js';
import type { Task, AgentType } from '@qunxiang/core';
import {
  prisma,
  BookRepository,
  UserRepository,
  TaskRepository,
  ExtractionSessionRepository,
} from '@qunxiang/storage';
import { testUserInput } from '../../storage/src/test-fixtures.js';

/**
 * 安全防护：下面的「失败路径收敛」用例会清空所连数据库的业务表。
 * 官方测试入口（scripts/test-runner.mjs）会把 TEST_DATABASE_URL 与
 * DATABASE_URL 都指向测试库；直接裸跑 vitest 时没有这层隔离，prisma
 * 连的就是开发/生产库——必须跳过，防止误清生产数据（已发生过一次事故）。
 */
const dbUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || '';
const dbName = (() => {
  try {
    return new URL(dbUrl).pathname.replace(/^\//, '').split('?')[0];
  } catch {
    return '';
  }
})();
const isGuardedTestDb = /test/i.test(dbName);
if (!isGuardedTestDb) {
  console.warn(
    `[dispatcher.resume.test] 未检测到测试库（当前库名「${dbName || '未知'}」不含 test），跳过会清库的收敛用例。请通过 pnpm test 运行。`,
  );
}

/**
 * 断点续传契约测试：
 * 1. stageResults 两种历史形态（按阶段键 / 暂停恢复的扁平对象）都能还原成
 *    agent 期望的顶层累积 payload——修复续跑阶段拿到空输入直接 TypeError 的缺陷。
 * 2. 被跳过阶段的 Task.result 写回真实数据（扁平形态在最后一个被跳过阶段
 *    写入完整累积 payload，保证后续再次失败续跑可从任务行重建输入）。
 * 3. 失败路径同步收敛 ExtractionSession 到 FAILED（否则一书被活动会话永久锁死）。
 */

interface QueueCall {
  enqueued: Array<{ bookId: string; agentType: AgentType; payload: Record<string, unknown> }>;
  completed: Array<{ id: string; result: unknown }>;
  failed: Array<{ id: string; error: string }>;
}

/** 记录型内存队列：dequeue 按 agentType 取最早的 pending 任务并标记 running。 */
function createRecordingQueue(tasks: Array<Partial<Task> & { agentType: AgentType }>): { queue: TaskQueue; calls: QueueCall } {
  const rows = tasks.map((t, i) => ({
    id: `task-${i}`,
    createdAt: new Date(),
    updatedAt: new Date(),
    status: 'pending' as const,
    retryCount: 0,
    ...t,
  })) as Task[];
  const calls: QueueCall = { enqueued: [], completed: [], failed: [] };
  const queue: TaskQueue = {
    async enqueue(task) {
      calls.enqueued.push({
        bookId: task.bookId,
        agentType: task.agentType,
        payload: (task.payload ?? {}) as Record<string, unknown>,
      });
      rows.push({
        id: `task-${rows.length}`,
        createdAt: new Date(),
        updatedAt: new Date(),
        status: 'pending',
        retryCount: 0,
        ...task,
      } as Task);
      return `task-${rows.length - 1}`;
    },
    async dequeue(agentType) {
      const next = rows.find((t) => t.agentType === agentType && t.status === 'pending');
      if (!next) return null;
      next.status = 'running';
      return next;
    },
    async complete(id, result) {
      calls.completed.push({ id, result });
      const row = rows.find((t) => t.id === id);
      if (row) row.status = 'completed';
    },
    async fail(id, error) {
      calls.failed.push({ id, error });
      const row = rows.find((t) => t.id === id);
      if (row) row.status = 'failed';
    },
    async heartbeat() {
      // 测试内无需真实心跳
    },
    async getStatus() {
      return null;
    },
    async getPending() {
      return [];
    },
    async addToDeadLetter(id, error) {
      calls.failed.push({ id, error });
    },
    async findStuckTasks() {
      return [];
    },
    async recoverStuckTask() {
      return undefined;
    },
  };
  return { queue, calls };
}

/** 替换 dispatcher 私有 agent 表（运行时注入桩，不改变生产行为）。 */
function stubAgents(dispatcher: TaskDispatcher, stubs: Partial<Record<AgentType, (payload: unknown) => Promise<unknown>>>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const agents = (dispatcher as any).agents as Map<AgentType, (payload: unknown) => Promise<unknown>>;
  for (const [type, fn] of Object.entries(stubs)) {
    agents.set(type as AgentType, fn!);
  }
}

describe('mergeResumeStageResults', () => {
  it('按阶段键形态：按管线顺序合并各阶段结果', () => {
    const merged = mergeResumeStageResults({
      extractor: { characters: [{ name: 'A' }], step: 1 },
      validator: { characters: [{ name: 'A', confidence: 0.9 }], validated: true },
    });
    // validator 在 extractor 之后，同名字段以后者为准（等价于正常运行时的顺序 spread）
    expect(merged.characters).toEqual([{ name: 'A', confidence: 0.9 }]);
    expect(merged.step).toBe(1);
    expect(merged.validated).toBe(true);
  });

  it('扁平形态（暂停恢复 manifest）：整体作为累积 payload 使用', () => {
    const flat = { characters: [{ name: 'B' }], locations: [], resumeFrom: 'validator' };
    const merged = mergeResumeStageResults(flat);
    expect(merged).toEqual(flat);
  });

  it('数组与原始值不被误判为阶段结果', () => {
    const merged = mergeResumeStageResults({ characters: [], extractor: 'not-an-object' });
    expect(merged).toEqual({ characters: [], extractor: 'not-an-object' });
  });
});

describe('processNext 续跑 payload 契约', () => {
  it('按阶段键形态：跳过阶段写回真实 result，执行阶段拿到顶层累积输入', async () => {
    const extractorResult = { characters: [{ name: '林动' }], locations: [], items: [], worldviews: [] };
    const { queue, calls } = createRecordingQueue([
      {
        bookId: 'book-x',
        agentType: 'extractor',
        payload: {
          bookId: 'book-x',
          userId: 'user-x',
          resumeFrom: 'validator',
          stageResults: { extractor: extractorResult },
        },
      },
    ]);
    const dispatcher = new TaskDispatcher(queue);
    const extractorSpy = vi.fn(async () => ({ late: true }));
    const received: unknown[] = [];
    stubAgents(dispatcher, {
      extractor: extractorSpy,
      // 用不可重试错误终止链条，聚焦断言续跑输入
      validator: async (payload) => {
        received.push(payload);
        throw new Error('LLM provider not configured');
      },
    });

    await dispatcher.processNext('extractor');

    // 被跳过的 extractor 不执行，且 Task.result 写回的是 stageResults.extractor
    expect(extractorSpy).not.toHaveBeenCalled();
    expect(calls.completed).toEqual([{ id: 'task-0', result: extractorResult }]);
    // validator 拿到顶层 characters（修复点：此前为 undefined → TypeError）
    expect(received).toHaveLength(1);
    expect((received[0] as { characters?: unknown }).characters).toEqual([{ name: '林动' }]);
    // 失败被记录（不可重试，立即失败）
    expect(calls.failed).toHaveLength(1);
    expect(calls.failed[0].error).toContain('not configured');
  });

  it('扁平形态（暂停恢复）：执行阶段拿到 manifest 中的累积 payload；最后一个被跳过阶段写回完整 payload', async () => {
    const flatPayload = { characters: [{ name: '萧炎' }], locations: [], items: [], worldviews: [], mergedUpTo: 'extractor' };
    const { queue, calls } = createRecordingQueue([
      {
        bookId: 'book-y',
        agentType: 'extractor',
        payload: { bookId: 'book-y', userId: 'user-y', resumeFrom: 'validator', stageResults: flatPayload },
      },
    ]);
    const dispatcher = new TaskDispatcher(queue);
    const received: unknown[] = [];
    stubAgents(dispatcher, {
      validator: async (payload) => {
        received.push(payload);
        throw new Error('LLM provider not configured');
      },
    });

    await dispatcher.processNext('extractor');

    expect((received[0] as { characters?: unknown }).characters).toEqual([{ name: '萧炎' }]);
    // extractor 是 resumeFrom 前最后一个被跳过阶段 → 写回完整累积 payload
    expect(calls.completed).toEqual([{ id: 'task-0', result: flatPayload }]);
  });

  it('正常完成后向下一阶段传播合并 payload', async () => {
    const extractorResult = { characters: [{ name: '牧尘' }] };
    const { queue, calls } = createRecordingQueue([
      {
        bookId: 'book-z',
        agentType: 'extractor',
        payload: { bookId: 'book-z', userId: 'user-z', resumeFrom: 'validator', stageResults: { extractor: extractorResult } },
      },
    ]);
    const dispatcher = new TaskDispatcher(queue);
    const received: unknown[] = [];
    stubAgents(dispatcher, {
      validator: async () => ({ characters: [{ name: '牧尘', confidence: 0.9 }] }),
      'entity-resolution': async (payload) => {
        received.push(payload);
        throw new Error('LLM provider not configured');
      },
    });

    await dispatcher.processNext('extractor');

    // entity-resolution 收到的 payload 顶层合并了 validator 的结果
    expect(received).toHaveLength(1);
    expect((received[0] as { characters?: unknown }).characters).toEqual([{ name: '牧尘', confidence: 0.9 }]);
    expect(calls.enqueued.map((e) => e.agentType)).toEqual(['validator', 'entity-resolution']);
  });
});

describe.skipIf(!isGuardedTestDb)('processNext 失败路径收敛运行会话', () => {
  let bookId: string;
  let userId: string;

  beforeEach(async () => {
    await prisma.characterReview.deleteMany();
    await prisma.character.deleteMany();
    await prisma.location.deleteMany();
    await prisma.item.deleteMany();
    await prisma.task.deleteMany();
    await prisma.extractionSession.deleteMany();
    await prisma.book.deleteMany();
    await prisma.user.deleteMany();
    const user = await UserRepository.create(testUserInput('dispatcher-conv@example.com', '收敛测试用户'));
    userId = user.id;
    const book = await BookRepository.create({
      title: '收敛测试书',
      filePath: '/tmp/conv.txt',
      fileSize: 10,
      mimeType: 'text/plain',
      userId,
    });
    bookId = book.id;
  });

  it('agent 失败时 ExtractionSession 与书都收敛到 FAILED', async () => {
    const { id: runId } = await ExtractionSessionRepository.create({
      bookId,
      userId,
      kind: 'LIVE',
      status: 'RUNNING',
    });
    const task = await TaskRepository.create({
      bookId,
      agentType: 'extractor',
      payload: { bookId, userId },
      status: 'pending',
    });

    const dispatcher = new TaskDispatcher({
      async enqueue(t) {
        return TaskRepository.create({ bookId: t.bookId, agentType: t.agentType, payload: t.payload, status: t.status as string }).then((r) => r.id);
      },
      async dequeue(agentType) {
        return TaskRepository.claimNext(agentType);
      },
      async complete(id, result) {
        await TaskRepository.updateStatus(id, 'completed', result);
      },
      async fail(id, error) {
        await TaskRepository.updateStatus(id, 'failed', undefined, error);
      },
      async heartbeat(id) {
        await TaskRepository.heartbeat(id);
      },
      async getStatus(id) {
        return TaskRepository.findById(id);
      },
      async getPending() {
        return [];
      },
      async addToDeadLetter() {
        return undefined;
      },
      async findStuckTasks() {
        return [];
      },
      async recoverStuckTask() {
        return undefined;
      },
    });
    stubAgents(dispatcher, {
      // 不可重试错误：立即失败，测试不引入重试等待
      extractor: async () => {
        throw new Error('LLM provider not configured');
      },
    });
    void task;

    await dispatcher.processNext('extractor');

    const session = await prisma.extractionSession.findUnique({ where: { id: runId } });
    expect(session?.status).toBe('FAILED');
    const book = await prisma.book.findUnique({ where: { id: bookId } });
    expect(book?.status).toBe('FAILED');
    const taskRow = await TaskRepository.findById(task.id);
    expect(taskRow?.status).toBe('failed');
  });
});

describe('startWorkers 热重载不再误杀在跑任务', () => {
  it('仅进程首次启动时回收孤儿任务，重载 worker 不再触发回收', async () => {
    const { queue } = createRecordingQueue([]);
    const dispatcher = new TaskDispatcher(queue);
    const recoverSpy = vi.spyOn(dispatcher, 'recoverInterruptedTasks').mockResolvedValue(undefined);

    dispatcher.startWorkers(1, 5);
    expect(recoverSpy).toHaveBeenCalledTimes(1);

    dispatcher.stopWorkers();
    dispatcher.startWorkers(2, 5);
    expect(recoverSpy).toHaveBeenCalledTimes(1);

    dispatcher.stopWorkers();
  });
});
