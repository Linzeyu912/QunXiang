import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

// mock LLM：createRun 的模型可用性检查需要 getDefaultProvider。
// 收敛测试里让它第一次（createRun）成功、第二次（startExtraction 内部）抛错。
vi.mock('@qunxiang/llm', () => ({
  getDefaultProvider: vi.fn(),
  getApiKeyCount: vi.fn(() => 1),
}));

// extraction.service 模块加载即启动真实 worker，mock 掉调度器实现。
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

import { getDefaultProvider } from '@qunxiang/llm';
import {
  prisma,
  BookRepository,
  UserRepository,
  ExtractionSessionRepository,
} from '@qunxiang/storage';
import { testUserInput } from '../../../storage/src/test-fixtures.js';
import { ConflictError } from '../lib/errors.js';
import { createRun, pauseRun } from './extraction-run.service.js';

/**
 * 运行会话收敛与暂停语义测试：
 * 1. createRun 启动管线失败时，QUEUED 会话必须收敛为 FAILED——
 *    否则活动会话把一书永久锁死（唯一索引 + findActiveByBook 永远 409）。
 * 2. pauseRun 对终态会话保持 409，不覆写终态。
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
  vi.mocked(getDefaultProvider).mockReset();
  await wipeAll();
  const user = await UserRepository.create(testUserInput('run-conv@example.com', '运行收敛用户'));
  ownerId = user.id;
  const book = await BookRepository.create({
    title: '运行收敛书',
    filePath: '/tmp/run-conv.txt',
    fileSize: 10,
    mimeType: 'text/plain',
    userId: ownerId,
  });
  bookId = book.id;
  // 对齐版本确认门禁：createRun/startExtraction 都要求 preprocessConfirmedRevision === sourceRevision
  await prisma.book.update({
    where: { id: bookId },
    data: { preprocessConfirmedRevision: book.sourceRevision },
  });
});

afterEach(async () => {
  await wipeAll();
});

describe('createRun 启动失败收敛', () => {
  it('startExtraction 抛错时会话收敛为 FAILED、书籍标记 FAILED，错误继续上抛', async () => {
    // 第一次调用：createRun 的 provider 检查；第二次：startExtraction 内部 → 抛错
    vi.mocked(getDefaultProvider)
      .mockResolvedValueOnce({ name: 'mock', isConfigured: async () => true } as never)
      .mockRejectedValueOnce(new Error('LLM provider not configured') as never);

    await expect(createRun(bookId, ownerId)).rejects.toThrow('not configured');

    const session = await prisma.extractionSession.findFirst({ where: { bookId } });
    expect(session?.status).toBe('FAILED');
    const book = await prisma.book.findUnique({ where: { id: bookId } });
    expect(book?.status).toBe('FAILED');
  });
});

describe('pauseRun 状态语义', () => {
  it('RUNNING 会话可暂停为 PAUSING', async () => {
    const { id: runId } = await ExtractionSessionRepository.create({ bookId, userId: ownerId, status: 'RUNNING' });
    await pauseRun(bookId, ownerId, runId);
    const session = await prisma.extractionSession.findUnique({ where: { id: runId } });
    expect(session?.status).toBe('PAUSING');
    expect(session?.pauseRequestedAt).not.toBeNull();
  });

  it('已完成的会话暂停返回 409（ConflictError），不覆写终态', async () => {
    const { id: runId } = await ExtractionSessionRepository.create({ bookId, userId: ownerId, status: 'COMPLETED' });
    await expect(pauseRun(bookId, ownerId, runId)).rejects.toThrow(ConflictError);
    const session = await prisma.extractionSession.findUnique({ where: { id: runId } });
    expect(session?.status).toBe('COMPLETED');
  });
});

describe('markResumed 条件更新', () => {
  it('仅 PAUSED 可恢复；重复恢复或非 PAUSED 状态返回 false', async () => {
    const { id: runId } = await ExtractionSessionRepository.create({ bookId, userId: ownerId, status: 'PAUSED' });
    await expect(ExtractionSessionRepository.markResumed(runId)).resolves.toBe(true);
    // 第二次（已 RUNNING）不得覆写，也不能把并发取消的会话复活
    await expect(ExtractionSessionRepository.markResumed(runId)).resolves.toBe(false);
    const session = await prisma.extractionSession.findUnique({ where: { id: runId } });
    expect(session?.status).toBe('RUNNING');
  });
});
