import type { AgentType, Task } from '@novel-agent/core';
import type { TaskQueue } from './task-queue.js';
import { getNextAgent, EXTRACTION_PIPELINE } from './pipeline.js';
import {
  executeExtractor,
  executeValidator,
  executeResolution,
  executeDescriptionFusion,
  executeVisualDescription,
  executePromptGeneration,
  executeReviewer,
} from './agents/index.js';
import { CharacterRepository, LocationRepository, ItemRepository, BookRepository, TaskRepository } from '@novel-agent/storage';
import { eventBus, type PipelineEvent } from './event-bus.js';
import { writePipelineFinalSummary } from './pipeline-summary.js';
import { summarizeExtractionResult, EMPTY_EXTRACTION_REASON } from './extraction-result-summary.js';

const DEFAULT_RETRY_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
};

interface RetryResult<T> {
  result?: T;
  error?: string;
  attempts: number;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * 判断错误是否值得重试。配置/鉴权/参数类的永久错误重试也没用，直接失败，
 * 避免在 API key 未配、401、403 等情况下白烧 4 次 LLM 调用。
 * 其余（网络/超时/上游 5xx/偶发解析）保持重试。
 *
 * 注意：JSON 解析失败（VALIDATION_ERROR）也判为不可重试——这类错误通常是
 * prompt 格式或模型输出问题，重试基本无效，却会被 extractor 内层批次重试 +
 * dispatcher 外层重试 + recoverFailedBatch 三层叠加放大，白烧几十次调用。
 */
function isRetryableError(err: unknown): boolean {
  const msg = errorMessage(err).toLowerCase();
  // 配置/鉴权/参数类永久错误
  if (/not configured|api[\s_-]?key|unauthorized|forbidden|\b401\b|\b403\b|invalid api key/.test(msg)) {
    return false;
  }
  // JSON 解析 / 校验失败：重试基本无效（prompt 或模型输出问题）
  if (/validation_error|failed to parse.*json|parse llm response as json|empty response from/.test(msg)) {
    return false;
  }
  return true;
}

async function withRetry<T>(
  fn: () => Promise<T>,
  config = DEFAULT_RETRY_CONFIG
): Promise<RetryResult<T>> {
  let attempts = 0;
  let lastError: unknown;

  while (attempts <= config.maxRetries) {
    attempts++;
    try {
      const result = await fn();
      return { result, attempts };
    } catch (error) {
      lastError = error;
      if (!isRetryableError(error)) {
        // 永久错误，立即失败，不再重试
        return { error: errorMessage(error), attempts };
      }
      if (attempts <= config.maxRetries) {
        const delay = Math.min(
          config.baseDelayMs * Math.pow(2, attempts - 1),
          config.maxDelayMs
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  return { error: errorMessage(lastError), attempts };
}

export class TaskDispatcher {
  private agents = new Map<AgentType, (payload: unknown) => Promise<any>>();
  /**
   * Worker 池：每个 worker 一个定时器 + busy 标志。
   * 多 worker 让多本书可并行提取（worker 数 = min(key 数, 用户设定上限)）。
   * 任务消费是并发安全的——queue.dequeue 是"取走即标记 running"的原子操作，
   * 多个 worker 各自 dequeue 天然不会抢同一任务。
   */
  private workers: { timer: ReturnType<typeof setInterval> | null; busy: boolean }[] = [];

  private static readonly STAGE_NAMES: Record<AgentType, string> = {
    extractor: '角色提取',
    validator: '置信度校验',
    'entity-resolution': '实体消解',
    'description-fusion': '简介融合',
    reviewer: '审核入库',
    'visual-description': '视觉描述补全',
    'prompt-generation': '提示词生成',
  };

  constructor(private queue: TaskQueue) {
    this.agents
      .set('extractor', executeExtractor)
      .set('validator', executeValidator)
      .set('entity-resolution', executeResolution)
      .set('description-fusion', executeDescriptionFusion)
      .set('visual-description', executeVisualDescription)
      .set('prompt-generation', executePromptGeneration)
      .set('reviewer', executeReviewer);
  }

  /** Only enqueue the first task; execution is handled by the background worker */
  async startExtraction(bookId: string, userId: string): Promise<{ extractorTaskId: string }> {
    const extractorTaskId = await this.queue.enqueue({
      bookId,
      agentType: 'extractor',
      payload: { bookId, userId },
      status: 'pending',
    });

    return { extractorTaskId };
  }

  /**
   * Start background workers that poll for pending extractor tasks.
   *
   * 多 worker 并发：count 个 worker 各自独立轮询队列，多本书可同时提取。
   * 单 worker（count=1）退化为原有行为。调用前会先停掉旧 worker 池并回收
   * 上一进程遗留的 running 任务，因此可安全地多次调用以动态调整并发度。
   */
  startWorkers(count = 1, intervalMs = 1000) {
    this.stopWorkers();
    // 启动前回收上一进程遗留的 running 任务（不阻塞启动）
    void this.recoverInterruptedTasks().catch((err) =>
      console.error('[Dispatcher] startup recovery failed:', err),
    );
    const n = Math.max(1, Math.floor(count));
    for (let i = 0; i < n; i++) {
      const workerIdx = i;
      const worker = { timer: null as ReturnType<typeof setInterval> | null, busy: false };
      worker.timer = setInterval(async () => {
        if (worker.busy) return;
        worker.busy = true;
        try {
          await this.processNext('extractor');
        } finally {
          worker.busy = false;
        }
      }, intervalMs);
      this.workers.push(worker);
    }
    console.log(`[Dispatcher] 启动 ${n} 个 worker（间隔 ${intervalMs}ms）`);
  }

  /** 单 worker 兼容入口（等价于 startWorkers(1)）。 */
  startWorker(intervalMs = 1000) {
    this.startWorkers(1, intervalMs);
  }

  /** 当前 worker 数量（供上层判断是否需要调整并发度）。 */
  getWorkerCount(): number {
    return this.workers.length;
  }

  /**
   * 服务重启后，所有残留的 'running' 任务都是上一进程崩溃/被杀留下的孤儿
   *（单 worker 串行，正常运行不会久留 running）。把它们标失败，并按剩余任务
   * 重新推断每本受影响书的真实状态：reviewer 完成过 → EXTRACTED，否则 FAILED。
   * 用户随后可在前端干净地重新触发（startExtraction 的 deleteByBookId 会清掉这些任务）。
   */
  async recoverInterruptedTasks(): Promise<void> {
    const stuck = await this.queue.findStuckTasks(0);
    if (stuck.length === 0) return;
    const books = new Set<string>();
    for (const t of stuck) {
      try {
        await this.queue.fail(t.id, 'Interrupted by server restart');
        books.add(t.bookId);
        console.log(`[Dispatcher] recovered orphan task ${t.id} (book ${t.bookId}, ${t.agentType})`);
      } catch (err) {
        console.error(`[Dispatcher] failed to recover task ${t.id}:`, err);
      }
    }
    for (const bookId of books) {
      try {
        const tasks = await TaskRepository.findByBookId(bookId);
        const reviewerDone = tasks.some((t) => t.agentType === 'reviewer' && t.status === 'completed');
        const status = reviewerDone ? 'EXTRACTED' : 'FAILED';
        await BookRepository.updateStatus(bookId, status);
        console.log(`[Dispatcher] book ${bookId} status → ${status} after recovery`);
      } catch (err) {
        console.error(`[Dispatcher] failed to re-derive status for book ${bookId}:`, err);
      }
    }
  }

  /** 停止全部 worker（动态调整并发度时先调它再 startWorkers(n)）。 */
  stopWorkers() {
    for (const w of this.workers) {
      if (w.timer) clearInterval(w.timer);
    }
    this.workers = [];
  }

  /** 单 worker 兼容入口别名。 */
  stopWorker() {
    this.stopWorkers();
  }

  async processNext(agentType: AgentType): Promise<string | undefined> {
    const task = await this.queue.dequeue(agentType);
    if (!task) return undefined;

    console.log(`[Dispatcher] Processing ${agentType} task ${task.id}, bookId: ${task.bookId}, payload:`, JSON.stringify(task.payload));

    // Emit stage_start event
    eventBus.emit({
      type: 'stage_start',
      bookId: task.bookId,
      stageId: agentType,
      stageName: TaskDispatcher.STAGE_NAMES[agentType],
      timestamp: Date.now(),
    });

    const agent = this.agents.get(agentType);
    if (!agent) {
      await this.queue.fail(task.id, `Unknown agent type: ${agentType}`);
      await this.finalizePipeline(task.bookId, 'failed');
      eventBus.emit({ type: 'error', bookId: task.bookId, stageId: agentType, message: `Unknown agent type: ${agentType}`, timestamp: Date.now() });
      return undefined;
    }

    const payloadBookId = (task.payload as { bookId?: string })?.bookId;
    if (!task.bookId || !payloadBookId) {
      console.error(`[Dispatcher] FATAL: Task ${task.id} missing bookId! task.bookId=${task.bookId}, payload.bookId=${payloadBookId}`);
    }

    try {
      const { result, error, attempts } = await withRetry(
        () => agent(task.payload)
      );

      if (error) {
        if (attempts > DEFAULT_RETRY_CONFIG.maxRetries) {
          await this.queue.addToDeadLetter(task.id, error, attempts);
        } else {
          await this.queue.fail(task.id, error);
        }
        await this.finalizePipeline(task.bookId, 'failed');
        eventBus.emit({ type: 'error', bookId: task.bookId, stageId: agentType, message: error, timestamp: Date.now() });
        return undefined;
      }

      await this.queue.complete(task.id, result);

      // Emit stage_complete with cumulative progress weight
      const completedWeight = EXTRACTION_PIPELINE.findIndex((s) => s === agentType);
      const progress = ((completedWeight + 1) / EXTRACTION_PIPELINE.length) * 100;
      eventBus.emit({
        type: 'stage_complete',
        bookId: task.bookId,
        stageId: agentType,
        stageName: TaskDispatcher.STAGE_NAMES[agentType],
        progress: Math.round(progress),
        timestamp: Date.now(),
      });

      // Save characters to database before reviewer stage
      const nextAgent = getNextAgent(agentType);
      if (nextAgent === 'reviewer' && result && typeof result === 'object' && 'characters' in result) {
        const bookId = (task.payload as { bookId?: string }).bookId || task.bookId;
        const { characters: chars, locations: locs, items: entityItems, totalCount } =
          summarizeExtractionResult(result);

        // 空结果守卫：三类实体全为空，几乎等价于配置/输入有问题（LLM 没返回、
        // 全被幻觉过滤、批次全失败）。此时不应静默标完成，否则前端会看到"已完成"
        // 但角色/场景页面为空（历史 bug）。判失败，保留旧实体不被清，让用户重试。
        if (totalCount === 0) {
          await this.queue.fail(task.id, EMPTY_EXTRACTION_REASON);
          await this.finalizePipeline(task.bookId, 'failed');
          eventBus.emit({
            type: 'error',
            bookId: task.bookId,
            stageId: agentType,
            message: EMPTY_EXTRACTION_REASON,
            timestamp: Date.now(),
          });
          return undefined;
        }

        // 重新提取：先把上一轮的旧实体清掉，再 createMany 新结果，避免重复入库。
        // 放在 reviewer 入库前（而非管线起点）清，是为了让提取中途失败时旧实体仍可用。
        // 注意：必须先通过上面的空结果守卫再清，否则空结果会把旧实体清空后留白。
        await CharacterRepository.deleteByBookId(bookId);
        await LocationRepository.deleteByBookId(bookId);
        await ItemRepository.deleteByBookId(bookId);
        // chars/locs/entityItems 已在上方统一解包并做过空结果守卫
        if (chars.length > 0) {
          await CharacterRepository.createMany(
            chars.map((c: any) => ({
              bookId,
              name: c.name,
              aliases: Array.isArray(c.aliases) ? c.aliases : [],
              description: c.description || null,
              confidence: c.confidence || 0.5,
              status: 'PENDING',
              chapterRef: c.chapterRef || null,
              firstChapter: c.firstChapter ?? null,
              lastChapter: c.lastChapter ?? null,
              chapterAppearances: c.chapterAppearances ?? [],
              mentionCount: c.mentionCount ?? 0,
              dialogueCount: c.dialogueCount ?? 0,
              coCharacters: c.coCharacters ?? [],
              outfits: Array.isArray(c.outfits) ? c.outfits : [],
              tier: c.tier || 'candidate',
              importanceScore: c.importanceScore ?? 0,
              storyScore: c.storyScore ?? 0,
              productionScore: c.productionScore ?? 0,
              pillarCausal: c.pillarCausal ?? 0,
              pillarUniqueness: c.pillarUniqueness ?? 0,
              pillarTransition: c.pillarTransition ?? 0,
            }))
          );
        }

        // Persist locations
        if (locs.length > 0) {
          await LocationRepository.createMany(
            locs.map((l: any) => ({
              bookId,
              name: l.name,
              aliases: Array.isArray(l.aliases) ? l.aliases : [],
              description: l.description || undefined,
              confidence: l.confidence || 0.7,
              chapterRef: l.chapterRef || undefined,
              importanceScore: l.importanceScore ?? 0,
              tier: l.tier ?? 'candidate',
              storyScore: l.storyScore ?? 0,
              productionScore: l.productionScore ?? 0,
              pillarCausal: l.pillarCausal ?? 0,
              pillarUniqueness: l.pillarUniqueness ?? 0,
              pillarTransition: l.pillarTransition ?? 0,
              mentionCount: l.mentionCount ?? 0,
              firstChapter: l.firstChapter ?? undefined,
              lastChapter: l.lastChapter ?? undefined,
              chapterAppearances: l.chapterAppearances ?? [],
            }))
          );
          console.log(`[Dispatcher] Persisted ${locs.length} locations`);
        }

        // Persist items
        if (entityItems.length > 0) {
          await ItemRepository.createMany(
            entityItems.map((i: any) => ({
              bookId,
              name: i.name,
              aliases: Array.isArray(i.aliases) ? i.aliases : [],
              description: i.description || undefined,
              confidence: i.confidence || 0.7,
              chapterRef: i.chapterRef || undefined,
              importanceScore: i.importanceScore ?? 0,
              tier: i.tier ?? 'candidate',
              storyScore: i.storyScore ?? 0,
              productionScore: i.productionScore ?? 0,
              pillarCausal: i.pillarCausal ?? 0,
              pillarUniqueness: i.pillarUniqueness ?? 0,
              pillarTransition: i.pillarTransition ?? 0,
              mentionCount: i.mentionCount ?? 0,
              firstChapter: i.firstChapter ?? undefined,
              lastChapter: i.lastChapter ?? undefined,
              chapterAppearances: i.chapterAppearances ?? [],
              owners: Array.isArray(i.owners) ? i.owners : [],
            }))
          );
          console.log(`[Dispatcher] Persisted ${entityItems.length} items`);
        }
      }

      if (nextAgent) {
        const taskPayload = task.payload && typeof task.payload === 'object' ? task.payload as Record<string, unknown> : {};
        const resultPayload = result && typeof result === 'object' ? result as Record<string, unknown> : {};
        await this.queue.enqueue({
          bookId: task.bookId,
          agentType: nextAgent,
          payload: { ...taskPayload, ...resultPayload, bookId: task.bookId, userId: taskPayload.userId },
          status: 'pending',
        });
        return await this.processNext(nextAgent);
      }

      // Pipeline completed successfully
      await writePipelineFinalSummary(task.bookId, task.payload, result);
      await this.finalizePipeline(task.bookId, 'completed');
      eventBus.emit({ type: 'completed', bookId: task.bookId, progress: 100, timestamp: Date.now() });
      return task.id;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.queue.fail(task.id, errorMessage);
      await this.finalizePipeline(task.bookId, 'failed');
      eventBus.emit({ type: 'error', bookId: task.bookId, stageId: agentType, message: errorMessage, timestamp: Date.now() });
      return undefined;
    }
  }

  private async finalizePipeline(bookId: string, outcome: 'completed' | 'failed') {
    try {
      await BookRepository.updateStatus(bookId, outcome === 'completed' ? 'EXTRACTED' : 'FAILED');
    } catch (err) {
      console.error(`[Dispatcher] Failed to update book status for ${bookId}:`, err);
    }
  }

  async getTaskStatus(taskId: string): Promise<Task | null> {
    return this.queue.getStatus(taskId);
  }
}
