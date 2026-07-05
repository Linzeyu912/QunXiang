import { BookRepository, TaskRepository } from '@novel-agent/storage';
import { TaskDispatcher, DatabaseTaskQueue, eventBus } from '@novel-agent/scheduler';
import type { PipelineEvent } from '@novel-agent/scheduler';
import { CharacterRepository, LocationRepository, ItemRepository } from '@novel-agent/storage';
import { getDefaultProvider, getApiKeyCount } from '@novel-agent/llm';
import type { AgentType } from '@novel-agent/core';
import { ConflictError } from '../lib/errors.js';

const taskQueue = new DatabaseTaskQueue();
const dispatcher = new TaskDispatcher(taskQueue);

/**
 * 并发模式：
 * - parallel-books：worker 数 = key 数，多本书并行；单本内部并发度保守（每 key ~2 路）。
 * - single-book-speed：worker 数 = 1，全部 LLM 并发额度集中给当前这一本。
 *
 * 用户可在 LLM 设置页切换；切换会热重载 worker 数与单本内部并发度，无需重启 API。
 */
export type ConcurrencyMode = 'parallel-books' | 'single-book-speed';

let concurrencyMode: ConcurrencyMode = 'parallel-books';

/**
 * 根据并发模式 + key 数计算应启动的 worker 数。
 * parallel-books：min(key 数, 8)（8 是硬上限，避免起太多 worker 拖垮 SQLite/事件循环）。
 * single-book-speed：恒为 1。
 */
export function computeWorkerCount(mode: ConcurrencyMode, keyCount: number): number {
  if (mode === 'single-book-speed') return 1;
  if (keyCount <= 0) return 1; // 未配置 key 时仍起 1 个（任务会因未配置直接失败，符合现状）
  return Math.min(keyCount, 8);
}

/** 根据并发模式设置单本内部各 agent 的并发度（通过 env 注入，下次 createExtractor 生效）。 */
function applyIntraBookConcurrency(mode: ConcurrencyMode): void {
  if (mode === 'single-book-speed') {
    // 拉满单本内部并发：把每 key 的 ~10 路额度尽量用上。
    // 这里只设下限，若用户已显式设了更高的值则保留。
    const want = (k: string, v: number) => {
      const cur = parseInt(process.env[k] || '', 10);
      if (!Number.isFinite(cur) || cur < v) process.env[k] = String(v);
    };
    want('EXTRACTOR_MAX_CONCURRENT_BATCHES', 8);
    want('VISUAL_DESCRIPTION_MAX_CONCURRENT', 8);
  } else {
    // parallel-books：保守并发，避免单本占用过多额度导致并行多本时互相 429。
    process.env.EXTRACTOR_MAX_CONCURRENT_BATCHES = String(Math.max(2, Math.min(4, getApiKeyCount() * 2 || 2)));
    process.env.VISUAL_DESCRIPTION_MAX_CONCURRENT = String(Math.max(2, Math.min(4, getApiKeyCount() * 2 || 2)));
  }
}

/**
 * 应用当前并发配置：按模式设单本内部并发度，再启动对应数量的 worker。
 * 幂等：startWorkers 内部会先 stopWorkers 再起，可重复调用。
 */
export function applyConcurrency(): void {
  applyIntraBookConcurrency(concurrencyMode);
  const keyCount = getApiKeyCount();
  const workerCount = computeWorkerCount(concurrencyMode, keyCount);
  dispatcher.startWorkers(workerCount, 1000);
}

/** 用户切换并发模式时热重载：更新模式 + 重新应用。返回新的状态快照。 */
export function reconfigureWorkers(mode: ConcurrencyMode): {
  mode: ConcurrencyMode;
  keyCount: number;
  workers: number;
} {
  concurrencyMode = mode;
  applyConcurrency();
  return getConcurrencyStatus();
}

/** 当前并发状态快照（供 status 端点返回给前端展示）。 */
export function getConcurrencyStatus(): {
  mode: ConcurrencyMode;
  keyCount: number;
  workers: number;
  recommended: number;
} {
  const keyCount = getApiKeyCount();
  return {
    mode: concurrencyMode,
    keyCount,
    workers: dispatcher.getWorkerCount(),
    recommended: computeWorkerCount('parallel-books', keyCount),
  };
}

// 启动时应用一次并发配置（默认 parallel-books，worker 数随 key 数）
applyConcurrency();

const PIPELINE_STAGES: { id: AgentType; name: string; weight: number }[] = [
  { id: 'extractor', name: '角色提取', weight: 25 },
  { id: 'validator', name: '置信度校验', weight: 10 },
  { id: 'entity-resolution', name: '实体消解', weight: 15 },
  { id: 'description-fusion', name: '简介融合', weight: 15 },
  { id: 'visual-description', name: '视觉描述补全', weight: 15 },
  { id: 'prompt-generation', name: '提示词生成', weight: 10 },
  { id: 'reviewer', name: '审核入库', weight: 10 },
];

export async function startExtraction(bookId: string, userId: string) {
  // 幂等：该书已有 pending/running 任务 → 本次运行仍在进行，拒绝重复触发。
  // （孤儿 running 任务由 dispatcher 启动时的 recoverInterruptedTasks 回收，
  // 因此运行期出现的 running/running 即视为真实进行中。）
  const existing = await TaskRepository.findByBookId(bookId);
  if (existing.some((t) => t.status === 'pending' || t.status === 'running')) {
    throw new ConflictError('该书正在提取中，请等待当前运行结束');
  }

  try {
    // Update book status
    await BookRepository.updateStatus(bookId, 'EXTRACTING');

    // 清掉上一轮的遗留任务，确保 getExtractionStages / 进度反映的是本次运行，
    // 而不是上一次 completed/failed 的历史任务（否则重跑会瞬间显示"已完成"）。
    await TaskRepository.deleteByBookId(bookId);

    // Validate provider is available (will throw if not configured)
    const provider = await getDefaultProvider();

    // Enqueue extraction task; actual processing happens in the background worker
    const { extractorTaskId } = await dispatcher.startExtraction(bookId, userId);

    return { taskId: extractorTaskId, provider: provider.name };
  } catch (err) {
    await BookRepository.updateStatus(bookId, 'FAILED');
    throw err;
  }
}

export async function pollExtractionStatus(taskId: string) {
  const task = await dispatcher.getTaskStatus(taskId);
  if (!task) {
    return { status: 'not_found' };
  }

  const bookId = task.bookId;

  // If extraction failed, update book status
  if (task.status === 'failed') {
    await BookRepository.updateStatus(bookId, 'FAILED');
    return { status: 'failed', task };
  }

  // If extraction is complete (passed through all pipeline stages), fetch characters
  if (task.agentType === 'reviewer' && task.status === 'completed') {
    const characters = await CharacterRepository.findByBookId(bookId);

    // Update book status
    await BookRepository.updateStatus(bookId, 'EXTRACTED');

    return { status: 'completed', task, characters };
  }

  return { status: task.status, task };
}

export interface ExtractionStageInfo {
  id: string;
  name: string;
  weight: number;
  status: string;
  startedAt?: string;
  completedAt?: string;
  message?: string;
}

export interface ExtractionStagesResult {
  bookId: string;
  overallProgress: number;
  isRunning: boolean;
  isComplete: boolean;
  isFailed: boolean;
  stages: ExtractionStageInfo[];
}

export async function getExtractionStages(bookId: string): Promise<ExtractionStagesResult> {
  const tasks = await TaskRepository.findByBookId(bookId);

  let overallProgress = 0;
  let isComplete = false;
  let isFailed = false;

  const stages: ExtractionStageInfo[] = PIPELINE_STAGES.map((stage) => {
    const task = tasks.find((t) => t.agentType === stage.id);
    const status = task ? task.status : 'pending';

    if (status === 'completed') {
      overallProgress += stage.weight;
    } else if (status === 'running') {
      overallProgress += stage.weight * 0.5;
    } else if (status === 'failed') {
      isFailed = true;
    }

    return {
      id: stage.id,
      name: stage.name,
      weight: stage.weight,
      status,
      startedAt: task?.createdAt ? task.createdAt.toISOString() : undefined,
      completedAt: task?.updatedAt ? task.updatedAt.toISOString() : undefined,
      message: task?.error || undefined,
    };
  });

  // 防御性校验：reviewer 任务完成，不代表真的有实体入库。
  // dispatcher 已对空结果判失败（主修复），这里是对历史数据/异常路径的二次保险——
  // 若 reviewer 标完成但 DB 三类实体全空，则不判 isComplete，避免前端误报"已完成"
  // 却在角色/场景页面看到空白（历史 bug）。
  const reviewerStage = stages.find((s) => s.id === 'reviewer');
  if (reviewerStage?.status === 'completed') {
    const [chars, locs, items] = await Promise.all([
      CharacterRepository.findByBookId(bookId),
      LocationRepository.findByBookId(bookId),
      ItemRepository.findByBookId(bookId),
    ]);
    if (chars.length === 0 && locs.length === 0 && items.length === 0) {
      // reviewer 任务状态仍是 completed（来自任务表），但语义上没有产出，
      // 在 stage 上标注原因，让前端 StageCard 能显示，且不进入 isComplete。
      reviewerStage.message = '审核入库完成，但未提取到任何角色/场景/道具';
    } else {
      isComplete = true;
      overallProgress = 100;
    }
  }

  // 仅当存在 pending/running 任务且未到终态时才算"运行中"。
  // 旧逻辑 `!isComplete && !isFailed` 会让一本从未开始的书（无任务）也被判为运行中，
  // 导致前端对它挂一条永不停的 SSE 心跳。
  const hasActiveTask = tasks.some((t) => t.status === 'pending' || t.status === 'running');

  return {
    bookId,
    overallProgress: Math.round(overallProgress),
    isRunning: hasActiveTask && !isComplete && !isFailed,
    isComplete,
    isFailed,
    stages,
  };
}

/**
 * Create an SSE stream for real-time extraction progress.
 * Returns an async generator that yields SSE-formatted strings.
 */
export async function* createExtractionStream(
  bookId: string
): AsyncGenerator<string> {
  // Send initial state (full stages snapshot)
  const initialState = await getExtractionStages(bookId);
  yield `data: ${JSON.stringify(initialState)}\n\n`;

  // If already complete or failed, close immediately
  if (initialState.isComplete || initialState.isFailed) {
    return;
  }

  // 订阅该 bookId 的管线事件。用具名 handler + eventBus.off 精确退订——
  // 不要用 removeAllListeners（会拆掉其它 SSE 客户端的监听）。
  const eventQueue: PipelineEvent[] = [];
  let resolveWaiter: (() => void) | null = null;
  const handler = (event: PipelineEvent) => {
    eventQueue.push(event);
    if (resolveWaiter) {
      resolveWaiter();
      resolveWaiter = null;
    }
  };
  eventBus.on(bookId, handler);

  try {
    while (true) {
      // Wait for next event or heartbeat timeout
      const result = await new Promise<PipelineEvent | 'heartbeat'>((resolve) => {
        // Drain any queued events immediately
        if (eventQueue.length > 0) {
          resolve(eventQueue.shift()!);
          return;
        }
        // Otherwise wait for new event or heartbeat
        resolveWaiter = () => {
          if (eventQueue.length > 0) {
            resolve(eventQueue.shift()!);
          } else {
            // Event was consumed by another check; re-wait will happen next loop iteration
            // This shouldn't happen normally but handle gracefully
            resolve('heartbeat');
          }
        };
        setTimeout(() => {
          if (resolveWaiter) {
            resolveWaiter = null;
            resolve('heartbeat');
          }
        }, 15000);
      });

      if (result === 'heartbeat') {
        yield ': heartbeat\n\n';
      } else {
        const sseEvent = `event: ${result.type}\ndata: ${JSON.stringify(result)}\n\n`;
        yield sseEvent;

        // Stop on terminal events
        if (result.type === 'completed' || result.type === 'error') {
          return;
        }
      }
    }
  } finally {
    eventBus.off(bookId, handler);
  }
}
