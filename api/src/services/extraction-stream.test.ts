import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

// extraction.service.ts 顶部 import { getDefaultProvider } from '@qunxiang/llm'，
// vitest 在 api 包内单独解析时找不到该包，mock 掉（本测试不涉及 LLM）。
vi.mock('@qunxiang/llm', () => ({
  getDefaultProvider: vi.fn(),
  getApiKeyCount: vi.fn(() => 1),
}));

// 保留真实的 eventBus 与 EXTRACTION_PIPELINE，仅替换会启动真实轮询的
// TaskDispatcher / DatabaseTaskQueue（extraction.service 模块加载即启动 worker）。
vi.mock('@qunxiang/scheduler', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@qunxiang/scheduler')>();
  return {
    ...actual,
    TaskDispatcher: vi.fn().mockImplementation(() => ({
      startWorkers: vi.fn(),
      stopWorkers: vi.fn(),
      getWorkerCount: vi.fn(() => 1),
      startExtraction: vi.fn(),
      resumeExtraction: vi.fn(),
      processNext: vi.fn(),
    })),
    DatabaseTaskQueue: vi.fn().mockImplementation(() => ({
      enqueue: vi.fn(),
      dequeue: vi.fn(),
    })),
  };
});

import { prisma, BookRepository, UserRepository, TaskRepository } from '@qunxiang/storage';
import { testUserInput } from '../../../storage/src/test-fixtures.js';
import { createExtractionStream } from './extraction.service.js';
import { eventBus } from '@qunxiang/scheduler';

/**
 * SSE 客户端断开清理测试：
 * 中止信号必须让生成器立即返回并精确退订 eventBus——否则监听器与心跳
 * 要等到终态事件才释放，反复断开重连会持续累积监听器（资源泄漏）。
 */

let bookId: string;
let ownerId: string;

async function wipeAll() {
  await prisma.characterReview.deleteMany();
  await prisma.character.deleteMany();
  await prisma.location.deleteMany();
  await prisma.item.deleteMany();
  await prisma.task.deleteMany();
  await prisma.extractionSession.deleteMany();
  await prisma.book.deleteMany();
  await prisma.user.deleteMany();
}

beforeEach(async () => {
  await wipeAll();
  const user = await UserRepository.create(testUserInput('stream-test@example.com', '流测试用户'));
  ownerId = user.id;
  const book = await BookRepository.create({
    title: '流测试书',
    filePath: '/tmp/stream.txt',
    fileSize: 10,
    mimeType: 'text/plain',
    userId: ownerId,
  });
  bookId = book.id;
});

afterEach(async () => {
  await wipeAll();
});

describe('createExtractionStream 客户端断开清理', () => {
  it('中止信号触发退订：监听器计数归零，生成器结束', async () => {
    const controller = new AbortController();
    const stream = createExtractionStream(bookId, ownerId, controller.signal);

    const first = await stream.next();
    expect(first.done).toBe(false);

    // 请求第二个值让生成器从首个 yield 恢复并完成事件订阅
    const secondPromise = stream.next();
    await new Promise((resolve) => setImmediate(resolve));
    expect(eventBus.getListenerCount(bookId)).toBe(1);

    controller.abort();
    const afterAbort = await secondPromise;
    expect(afterAbort.done).toBe(true);
    expect(eventBus.getListenerCount(bookId)).toBe(0);
  });

  it('终态事件（completed）后生成器自然结束并退订', async () => {
    const controller = new AbortController();
    const stream = createExtractionStream(bookId, ownerId, controller.signal);

    await stream.next(); // 初始快照
    const secondPromise = stream.next();
    await new Promise((resolve) => setImmediate(resolve));
    expect(eventBus.getListenerCount(bookId)).toBe(1);

    eventBus.emit({ type: 'completed', bookId, progress: 100, timestamp: Date.now() });
    const terminal = await secondPromise;
    expect(terminal.done).toBe(false); // completed 事件本身仍会下发
    expect(String(terminal.value)).toContain('event: completed');

    const ended = await stream.next();
    expect(ended.done).toBe(true);
    expect(eventBus.getListenerCount(bookId)).toBe(0);
  });

  it('已完成书籍：发送初始快照后立即结束，不订阅事件', async () => {
    // 造一条已完成的 reviewer 任务 → isComplete → 生成器直接返回
    await TaskRepository.create({ bookId, agentType: 'reviewer', payload: { bookId }, status: 'completed' });
    await prisma.character.create({
      data: { bookId, name: '占位角色', status: 'APPROVED', reviewSource: 'USER' },
    });
    await prisma.book.update({ where: { id: bookId }, data: { status: 'EXTRACTED' } });

    const controller = new AbortController();
    const stream = createExtractionStream(bookId, ownerId, controller.signal);
    const first = await stream.next();
    expect(first.done).toBe(false);
    const second = await stream.next();
    expect(second.done).toBe(true);
    expect(eventBus.getListenerCount(bookId)).toBe(0);
  });
});
