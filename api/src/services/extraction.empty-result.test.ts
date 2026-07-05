import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// extraction.service.ts 顶部 import { getDefaultProvider } from '@novel-agent/llm'，
// 该包通过 scheduler 间接依赖，vitest 在 api 包内单独解析时会找不到。这里 mock 掉
// （本测试只关心 getExtractionStages 的 DB 校验逻辑，不涉及 LLM）。
vi.mock('@novel-agent/llm', () => ({
  getDefaultProvider: vi.fn(),
  getApiKeyCount: vi.fn(() => 1),
  LLM_PROVIDERS: {},
}));

// extraction.service.ts 顶层会 new TaskDispatcher 并 startWorkers，scheduler 包
// 在 vitest 单跑时加载异常。mock 掉 scheduler，只保留 getExtractionStages 真实逻辑。
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
}));

import type { AgentType } from '@novel-agent/core';
import {
  prisma,
  BookRepository,
  UserRepository,
  TaskRepository,
  CharacterRepository,
  LocationRepository,
  ItemRepository,
} from '@novel-agent/storage';
import { getExtractionStages } from './extraction.service.js';

/**
 * 集成测试：验证"管道跑完但角色/场景/道具三类实体全空"时，
 * getExtractionStages 不再返回 isComplete=true（历史 bug 的复现+回归保护）。
 *
 * getExtractionStages 是前端 PipelinePage 判定"已完成"的唯一数据源；
 * dispatcher 已对空结果判失败（主修复），这里是对该函数防御性校验的二次保险验证。
 * 数据写入测试库（test.db，由 scripts/test.mjs 用 DATABASE_URL 指定并 prisma db push）。
 */

const PIPELINE: AgentType[] = [
  'extractor',
  'validator',
  'entity-resolution',
  'description-fusion',
  'visual-description',
  'prompt-generation',
  'reviewer',
];

async function seedCompletedPipeline(bookId: string) {
  for (const agentType of PIPELINE) {
    await TaskRepository.create({ bookId, agentType, payload: { bookId }, status: 'completed' });
  }
}

async function wipeAll() {
  // 顺序注意外键：reviews/characters/locations/items → book → user；task 独立
  await prisma.characterReview.deleteMany();
  await prisma.character.deleteMany();
  await prisma.location.deleteMany();
  await prisma.item.deleteMany();
  await prisma.task.deleteMany();
  await prisma.book.deleteMany();
  await prisma.user.deleteMany();
}

describe('getExtractionStages — 空结果不再误报"已完成"', () => {
  let bookId: string;

  beforeEach(async () => {
    await wipeAll();
    const user = await UserRepository.create({ email: 'stages-test@example.com', name: 'Stages Test' });
    const book = await BookRepository.create({
      title: '空结果测试书',
      filePath: '/tmp/empty.txt',
      fileSize: 10,
      mimeType: 'text/plain',
      userId: user.id,
    });
    bookId = book.id;
  });

  afterEach(async () => {
    await wipeAll();
  });

  it('reviewer 完成但 DB 三类实体全空 → isComplete=false，并在 reviewer stage 标注原因', async () => {
    await seedCompletedPipeline(bookId);
    // 故意不写入任何 character/location/item

    const result = await getExtractionStages(bookId);

    expect(result.isComplete, '空结果不应判完成').toBe(false);
    expect(result.isFailed, 'reviewer 任务本身是 completed，task 层不算 failed').toBe(false);
    const reviewer = result.stages.find((s) => s.id === 'reviewer');
    expect(reviewer?.message).toMatch(/未提取到任何/);
  });

  it('reviewer 完成且 DB 有实体 → isComplete=true（正常路径不回归）', async () => {
    await seedCompletedPipeline(bookId);
    await CharacterRepository.createMany([
      {
        bookId,
        name: '萧炎',
        aliases: [],
        confidence: 0.9,
      },
    ]);

    const result = await getExtractionStages(bookId);

    expect(result.isComplete, '有实体时应正常判完成').toBe(true);
    expect(result.overallProgress).toBe(100);
  });

  it('只有 location（无 character）也算有产出 → isComplete=true', async () => {
    await seedCompletedPipeline(bookId);
    await LocationRepository.createMany([
      {
        bookId,
        name: '乌坦城',
        aliases: [],
        confidence: 0.7,
        importanceScore: 0,
        tier: 'candidate',
        storyScore: 0,
        productionScore: 0,
        pillarCausal: 0,
        pillarUniqueness: 0,
        pillarTransition: 0,
        mentionCount: 0,
      },
    ]);

    const result = await getExtractionStages(bookId);
    expect(result.isComplete).toBe(true);
  });

  it('reviewer 尚未完成（无 reviewer 任务）→ isComplete=false', async () => {
    // 只跑到 prompt-generation，没有 reviewer
    for (const agentType of PIPELINE.filter((a) => a !== 'reviewer')) {
      await TaskRepository.create({ bookId, agentType, payload: { bookId }, status: 'completed' });
    }
    const result = await getExtractionStages(bookId);
    expect(result.isComplete).toBe(false);
  });
});
