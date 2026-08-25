import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// extraction.service.ts 顶层会 new TaskDispatcher / startWorker / getDefaultProvider。
// 这些会触发真实的 storage/scheduler/llm 初始化。Mock 掉以隔离测试。
const { resumeExtractionMock } = vi.hoisted(() => ({
  resumeExtractionMock: vi.fn(),
}));

vi.mock('@qunxiang/llm', () => ({
  getDefaultProvider: vi.fn(),
  getApiKeyCount: vi.fn(() => 1),
  LLM_PROVIDERS: {},
}));

vi.mock('@qunxiang/scheduler', () => ({
  TaskDispatcher: vi.fn().mockImplementation(() => ({
    startWorker: vi.fn(),
    startWorkers: vi.fn(),
    stopWorkers: vi.fn(),
    stopWorker: vi.fn(),
    getWorkerCount: vi.fn(() => 1),
    startExtraction: vi.fn(),
    getTaskStatus: vi.fn(),
    processNext: vi.fn(),
    resumeExtraction: resumeExtractionMock,
  })),
  DatabaseTaskQueue: vi.fn().mockImplementation(() => ({
    enqueue: vi.fn(),
    dequeue: vi.fn(),
  })),
  eventBus: { emit: vi.fn() },
  EXTRACTION_PIPELINE: [
    'extractor',
    'validator',
    'entity-resolution',
    'description-fusion',
    'visual-description',
    'prompt-generation',
    'reviewer',
  ],
}));

import {
  prisma,
  BookRepository,
  UserRepository,
  TaskRepository,
} from '@qunxiang/storage';
import { resumeExtraction } from './extraction.service.js';
import { ConflictError, NotFoundError } from '../lib/errors.js';

async function wipeAll() {
  await prisma.task.deleteMany();
  await prisma.book.deleteMany();
  await prisma.user.deleteMany();
}

async function seedUserAndBook() {
  const user = await UserRepository.create({
    email: 'resume@example.com',
    emailNormalized: 'resume@example.com',
    name: 'Resume User',
    passwordHash: 'test-hash',
    shareCodeHash: 'test-share-hash',
  });
  const book = await BookRepository.create({
    title: 'Resume Test Book',
    filePath: '/tmp/resume.txt',
    fileSize: 1024,
    mimeType: 'text/plain',
    userId: user.id,
  });
  return { user, book };
}

describe('resumeExtraction — ISSUE-7 断点续传', () => {
  beforeEach(async () => {
    await wipeAll();
    resumeExtractionMock.mockReset();
    resumeExtractionMock.mockResolvedValue({ extractorTaskId: 'mock-task-id' });
  });

  afterEach(async () => {
    await wipeAll();
  });

  it('throws NotFoundError when book has no extraction tasks', async () => {
    const { book, user } = await seedUserAndBook();
    await expect(resumeExtraction(book.id, user.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws ConflictError when extraction is currently running', async () => {
    const { book, user } = await seedUserAndBook();
    await TaskRepository.create({
      bookId: book.id,
      agentType: 'extractor',
      payload: { bookId: book.id },
      status: 'running',
    });
    await expect(resumeExtraction(book.id, user.id)).rejects.toBeInstanceOf(ConflictError);
  });

  it('throws ConflictError when all stages already completed', async () => {
    const { book, user } = await seedUserAndBook();
    const stages = ['extractor', 'validator', 'entity-resolution', 'description-fusion', 'visual-description', 'prompt-generation', 'reviewer'];
    for (const s of stages) {
      await TaskRepository.create({
        bookId: book.id,
        agentType: s as never,
        payload: { bookId: book.id },
        status: 'completed',
        result: { ok: true },
      });
    }
    await expect(resumeExtraction(book.id, user.id)).rejects.toBeInstanceOf(ConflictError);
  });

  it('delegates to dispatcher.resumeExtraction with resumeFrom + stageResults', async () => {
    const { book, user } = await seedUserAndBook();
    // 模拟历史:extractor/validator 成功,entity-resolution 失败
    await TaskRepository.create({
      bookId: book.id,
      agentType: 'extractor',
      payload: { bookId: book.id },
      status: 'completed',
      result: { characters: [{ name: '萧炎' }] },
    });
    await TaskRepository.create({
      bookId: book.id,
      agentType: 'validator',
      payload: { bookId: book.id },
      status: 'completed',
      result: { validated: true },
    });
    await TaskRepository.create({
      bookId: book.id,
      agentType: 'entity-resolution',
      payload: { bookId: book.id },
      status: 'failed',
      error: 'LLM timeout',
    });

    const result = await resumeExtraction(book.id, user.id);

    expect(result.resumedFrom).toBe('entity-resolution');
    expect(result.taskId).toBe('mock-task-id');

    // 验证:委托 dispatcher.resumeExtraction,从失败点续传,复用前置 stage 的真实 result
    expect(resumeExtractionMock).toHaveBeenCalledTimes(1);
    const [bId, uId, resumeFrom, stageResults] = resumeExtractionMock.mock.calls[0];
    expect(bId).toBe(book.id);
    expect(uId).toBe(user.id);
    expect(resumeFrom).toBe('entity-resolution');
    expect(stageResults).toMatchObject({
      extractor: { characters: [{ name: '萧炎' }] },
      validator: { validated: true },
    });

    // 验证:历史任务行被清空(不再残留 failed/pending,由 dispatcher 重新走 extractor 入口)
    const after = await TaskRepository.findByBookId(book.id);
    expect(after).toHaveLength(0);

    // 验证:book 状态重置为 EXTRACTING
    const updatedBook = await BookRepository.findById(book.id);
    expect(updatedBook?.status).toBe('EXTRACTING');
  });

  it('clears all tasks including cascading-failed downstream stages', async () => {
    const { book, user } = await seedUserAndBook();
    // 模拟:visual-description 失败,后面还有级联 failed 的 stage
    const upstreamStages = ['extractor', 'validator', 'entity-resolution', 'description-fusion'];
    for (const s of upstreamStages) {
      await TaskRepository.create({
        bookId: book.id,
        agentType: s as never,
        payload: { bookId: book.id },
        status: 'completed',
        result: { [`${s}_result`]: true },
      });
    }
    await TaskRepository.create({
      bookId: book.id,
      agentType: 'visual-description',
      payload: { bookId: book.id },
      status: 'failed',
      error: 'bad input',
    });
    await TaskRepository.create({
      bookId: book.id,
      agentType: 'prompt-generation',
      payload: { bookId: book.id },
      status: 'failed',
      error: 'cascading failure',
    });

    await resumeExtraction(book.id, user.id);

    // 从最早的失败点(visual-description)续传
    const [, , resumeFrom, stageResults] = resumeExtractionMock.mock.calls[0];
    expect(resumeFrom).toBe('visual-description');
    expect(Object.keys(stageResults as Record<string, unknown>).sort()).toEqual(
      ['description-fusion', 'entity-resolution', 'extractor', 'validator'],
    );

    // 所有任务行(含级联 failed 的 prompt-generation)都被清空
    const after = await TaskRepository.findByBookId(book.id);
    expect(after).toHaveLength(0);
  });

  it('collects completed upstream results into stageResults for reuse', async () => {
    const { book, user } = await seedUserAndBook();
    // 全部跑完,只有 visual-description 失败
    const completedStages = ['extractor', 'validator', 'entity-resolution', 'description-fusion'];
    for (const s of completedStages) {
      await TaskRepository.create({
        bookId: book.id,
        agentType: s as never,
        payload: { bookId: book.id },
        status: 'completed',
        result: { [`${s}_result`]: true },
      });
    }
    await TaskRepository.create({
      bookId: book.id,
      agentType: 'visual-description',
      payload: { bookId: book.id },
      status: 'failed',
      error: 'EXIF parse error',
    });

    await resumeExtraction(book.id, user.id);

    const [, , resumeFrom, stageResults] = resumeExtractionMock.mock.calls[0];
    expect(resumeFrom).toBe('visual-description');
    // 已完成 stage 的 result 按 stage 归位,供 dispatcher 跳过时写回
    expect(stageResults).toMatchObject({
      extractor: { extractor_result: true },
      validator: { validator_result: true },
      'entity-resolution': { 'entity-resolution_result': true },
      'description-fusion': { 'description-fusion_result': true },
    });
    // 失败的 visual-description 不进入 stageResults(它需要重跑)
    expect(stageResults as Record<string, unknown>).not.toHaveProperty('visual-description');
  });
});
