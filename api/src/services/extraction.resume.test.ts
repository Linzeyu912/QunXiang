import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// extraction.service.ts 顶层会 new TaskDispatcher / startWorker / getDefaultProvider。
// 这些会触发真实的 storage/scheduler/llm 初始化。Mock 掉以隔离测试。
vi.mock('@novel-agent/llm', () => ({
  getDefaultProvider: vi.fn(),
  getApiKeyCount: vi.fn(() => 1),
  LLM_PROVIDERS: {},
}));

vi.mock('@novel-agent/scheduler', () => ({
  TaskDispatcher: vi.fn().mockImplementation(() => ({
    startWorker: vi.fn(),
    startWorkers: vi.fn(),
    stopWorkers: vi.fn(),
    stopWorker: vi.fn(),
    getWorkerCount: vi.fn(() => 1),
    startExtraction: vi.fn(),
    getTaskStatus: vi.fn(),
    processNext: vi.fn(),
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
} from '@novel-agent/storage';
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

  it('resumes from the first failed stage and reuses prior results', async () => {
    const { book, user } = await seedUserAndBook();
    // 模拟历史:extractor/validator 成功,entity-resolution 失败,后面 pending
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
    expect(result.taskId).toBeDefined();

    // 验证:failed stage 重置为 pending
    const after = await TaskRepository.findByBookId(book.id);
    const erTask = after.find((t) => t.agentType === 'entity-resolution');
    expect(erTask?.status).toBe('pending');
    expect(erTask?.error).toBeNull();

    // 验证:book 状态重置为 EXTRACTING
    const updatedBook = await BookRepository.findById(book.id);
    expect(updatedBook?.status).toBe('EXTRACTING');
  });

  it('resets downstream stages to pending so they re-run', async () => {
    const { book, user } = await seedUserAndBook();
    // 模拟:visual-description 失败,后面也有 failed 的 stage
    const upstreamStages = ['extractor', 'validator', 'entity-resolution', 'description-fusion'];
    for (const s of upstreamStages) {
      await TaskRepository.create({
        bookId: book.id,
        agentType: s as never,
        payload: { bookId: book.id },
        status: 'completed',
        result: {},
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

    const after = await TaskRepository.findByBookId(book.id);
    const vdStage = after.find((t) => t.agentType === 'visual-description');
    const pgStage = after.find((t) => t.agentType === 'prompt-generation');
    expect(vdStage?.status).toBe('pending');
    expect(pgStage?.status).toBe('pending');
  });

  it('does not re-run completed upstream stages', async () => {
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

    const after = await TaskRepository.findByBookId(book.id);
    // 已 completed 的 stage 保持 completed(没被重置)
    for (const s of completedStages) {
      const t = after.find((x) => x.agentType === s);
      expect(t?.status).toBe('completed');
    }
  });
});
