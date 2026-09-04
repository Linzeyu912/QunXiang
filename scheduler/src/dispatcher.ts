import type { AgentType, Task } from '@qunxiang/core';
import type { TaskQueue } from './task-queue.js';
import { getNextAgent, EXTRACTION_PIPELINE } from './pipeline.js';
import { isCollectiveCharacterAlias } from '@qunxiang/entity-resolution';
import {
  executeExtractor,
  executeValidator,
  executeResolution,
  executeDescriptionFusion,
  executeVisualDescription,
  executePromptGeneration,
  executeReviewer,
} from './agents/index.js';
import {
  CharacterRepository,
  LocationRepository,
  ItemRepository,
  WorldviewRepository,
  BookRepository,
  TaskRepository,
  prisma,
  ExtractionSessionRepository,
  createExtractionResidueCleanup,
} from '@qunxiang/storage';
import { eventBus, type PipelineEvent } from './event-bus.js';
import { writePipelineFinalSummary } from './pipeline-summary.js';
import { summarizeExtractionResult, buildEmptyExtractionMessage } from './extraction-result-summary.js';
import { persistVisualSpecsFromResult } from './visual-spec-writer.js';

const DEFAULT_RETRY_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
};
const MAX_IDLE_POLL_INTERVAL_MS = 5000;

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

/**
 * 把续跑 stageResults 还原成 agent 期望的顶层累积 payload。
 *
 * 历史上存在两种形态，都必须兼容：
 * 1) 按阶段键：服务层 resumeExtraction 从 Task.result 收集（{ extractor: {...}, validator: {...} }），
 *    按管线顺序逐段合并，等价于正常运行时逐阶段 spread 的累积结果。
 * 2) 扁平累积对象：运行暂停恢复时 manifest.stageResults 存的是「已合并 payload」
 *    （dispatcher 暂停分支写入），直接整体使用。
 * 判定依据：任一管线阶段键命中非数组对象即视为形态 1。
 */
export function mergeResumeStageResults(stageResults: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  let stageKeyed = false;
  for (const stage of EXTRACTION_PIPELINE) {
    const stageResult = stageResults[stage];
    if (stageResult && typeof stageResult === 'object' && !Array.isArray(stageResult)) {
      stageKeyed = true;
      Object.assign(merged, stageResult as Record<string, unknown>);
    }
  }
  if (!stageKeyed) {
    Object.assign(merged, stageResults);
  }
  return merged;
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
  private workers: {
    timer: ReturnType<typeof setTimeout> | null;
    busy: boolean;
    active: boolean;
    currentInterval: number;
  }[] = [];

  /**
   * worker 池是否已在本进程内启动过。
   * 只有进程首次启动才需要 recoverInterruptedTasks（回收上一进程孤儿任务）；
   * 热重载（保存模型配置/切换并发模式）时在跑任务属于本进程的在途 agent，
   * 此时按孤儿回收会把活任务误标失败、书误标 FAILED。
   */
  private workersEverStarted = false;

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
   * 断点续传：从 resumeFrom 阶段开始重跑，跳过前面已完成的阶段。
   *
   * 工作线程只消费提取器类型的任务，因此必须从提取器入口进入，
   * 再通过 resumeFrom 与 stageResults 跳过已完成阶段。
   */
  async resumeExtraction(
    bookId: string,
    userId: string,
    resumeFrom: AgentType,
    stageResults: Record<string, unknown>,
  ): Promise<{ extractorTaskId: string }> {
    const extractorTaskId = await this.queue.enqueue({
      bookId,
      agentType: 'extractor',
      payload: { bookId, userId, resumeFrom, stageResults },
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
  startWorkers(count = 1, intervalMs = 1000, beforeTaskClaim?: () => void | Promise<void>) {
    this.stopWorkers();
    // 仅进程首次启动时回收上一进程遗留的 running 任务；热重载时在跑任务
    // 属于本进程在途 agent，不能按孤儿回收（避免误杀活任务）。
    const isFirstStart = !this.workersEverStarted;
    this.workersEverStarted = true;
    if (isFirstStart) {
      void this.recoverInterruptedTasks().catch((err) =>
        console.error('[调度器] 启动时恢复任务失败：', err),
      );
    }
    const n = Math.max(1, Math.floor(count));
    // 超时回收：running 任务心跳超过 30 分钟判死（真卡死/进程被杀），改回 pending 重领。
    // 开发热重载的在途任务不受影响——它们每批完成会触碰 updatedAt，心跳不会超阈。
    const STUCK_RECOVERY_INTERVAL_MS = 60_000;
    const STUCK_TASK_THRESHOLD_MS = 30 * 60_000;
    const stuckRecoveryTimer = setInterval(() => {
      void this.recoverStuckTasks(STUCK_TASK_THRESHOLD_MS).catch((err) =>
        console.error('[调度器] 超时回收失败：', err),
      );
    }, STUCK_RECOVERY_INTERVAL_MS);
    stuckRecoveryTimer.unref?.();
    for (let i = 0; i < n; i++) {
      const worker = {
        timer: null as ReturnType<typeof setTimeout> | null,
        busy: false,
        active: true,
        currentInterval: intervalMs,
      };
      this.workers.push(worker);

      const scheduleNext = () => {
        if (!worker.active) return;
        worker.timer = setTimeout(async () => {
          if (!worker.active || worker.busy) return scheduleNext();
          worker.busy = true;
          let processed = false;
          try {
            await beforeTaskClaim?.();
            processed = Boolean(await this.processNext('extractor'));
          } catch (err) {
            console.error('[调度器] 领取提取任务前准备失败：', err);
          } finally {
            worker.busy = false;
            worker.currentInterval = processed
              ? intervalMs
              : Math.min(worker.currentInterval * 2, MAX_IDLE_POLL_INTERVAL_MS);
            scheduleNext();
          }
        }, worker.currentInterval);
        worker.timer.unref?.();
      };
      scheduleNext();
    }
    console.log(`[调度器] 启动 ${n} 个工作进程（间隔 ${intervalMs} 毫秒）`);
  }

  /** 单 worker 兼容入口（等价于 startWorkers(1)）。 */
  startWorker(intervalMs = 1000, beforeTaskClaim?: () => void | Promise<void>) {
    this.startWorkers(1, intervalMs, beforeTaskClaim);
  }

  /** 当前 worker 数量（供上层判断是否需要调整并发度）。 */
  getWorkerCount(): number {
    return this.workers.length;
  }

  /** 超时回收：心跳超阈值的 running 任务改回 pending 供重领（区别于重启孤儿回收） */
  private async recoverStuckTasks(thresholdMs: number): Promise<void> {
    const stuck = await this.queue.findStuckTasks(thresholdMs);
    if (stuck.length === 0) return;
    for (const t of stuck) {
      try {
        await this.queue.recoverStuckTask(t.id);
        console.log(`[调度器] 已回收卡死任务 ${t.id}（书籍 ${t.bookId}，阶段 ${t.agentType}）`);
      } catch (err) {
        console.error(`[调度器] 回收任务 ${t.id} 失败：`, err);
      }
    }
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
        await this.queue.fail(t.id, '服务重启导致任务中断');
        books.add(t.bookId);
        console.log(`[调度器] 已恢复孤立任务 ${t.id}（书籍 ${t.bookId}，阶段 ${t.agentType}）`);
      } catch (err) {
        console.error(`[调度器] 恢复任务 ${t.id} 失败：`, err);
      }
    }
    for (const bookId of books) {
      try {
        // 孤儿 ExtractionSession 同样要收敛：任务已按孤儿标失败，但活动会话
        //（QUEUED/RUNNING/PAUSED…）若不落终态，前端会永远轮询"当前运行进行中"，
        // 且「一书一活动运行」约束会让重新提取持续 409（历史 bug）。
        const orphanSession = await ExtractionSessionRepository.findActiveByBook(bookId) as { id: string } | null;
        if (orphanSession) {
          await ExtractionSessionRepository.markFailed(orphanSession.id, '服务重启导致运行中断');
          console.log(`[调度器] 已收敛孤立运行会话 ${orphanSession.id}（书籍 ${bookId}）`);
        }
        const tasks = await TaskRepository.findByBookId(bookId);
        const reviewerDone = tasks.some((t) => t.agentType === 'reviewer' && t.status === 'completed');
        const status = reviewerDone ? 'EXTRACTED' : 'FAILED';
        await BookRepository.updateStatus(bookId, status);
        console.log(`[调度器] 恢复后将书籍 ${bookId} 状态更新为 ${status}`);
      } catch (err) {
        console.error(`[调度器] 重新推导书籍 ${bookId} 状态失败：`, err);
      }
    }
  }

  /** 停止全部 worker（动态调整并发度时先调它再 startWorkers(n)）。 */
  stopWorkers() {
    for (const w of this.workers) {
      w.active = false;
      if (w.timer) clearTimeout(w.timer);
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

    // 断点续传：payload.resumeFrom 标记从哪个 stage 开始重跑。当前 agentType 在
    // resumeFrom 之前 → 该 stage 在前一轮已完成过，跳过执行，复用 stageResults 里
    // 保存的真实 result 标 completed，直接推进到下一 stage，直到 resumeFrom 才真正执行。
    const resumePayload = (task.payload && typeof task.payload === 'object'
      ? task.payload as Record<string, unknown>
      : {}) as Record<string, unknown>;
    const resumeFrom = resumePayload.resumeFrom as AgentType | undefined;
    if (resumeFrom && EXTRACTION_PIPELINE.indexOf(agentType) < EXTRACTION_PIPELINE.indexOf(resumeFrom)) {
      const stageResults = (resumePayload.stageResults ?? {}) as Record<string, unknown>;
      const nextAgent = getNextAgent(agentType);
      // 扁平形态（暂停恢复的 manifest）没有分阶段数据可写回；在最后一个被跳过
      // 阶段写入完整累积 payload，保证此后再次失败续跑时能从任务行重建输入。
      const fallbackResult = nextAgent && nextAgent === resumeFrom
        ? mergeResumeStageResults(stageResults)
        : {};
      await this.queue.complete(task.id, stageResults[agentType] ?? fallbackResult);
      if (nextAgent) {
        await this.queue.enqueue({
          bookId: task.bookId,
          agentType: nextAgent,
          payload: resumePayload,
          status: 'pending',
        });
        return await this.processNext(nextAgent);
      }
      return undefined;
    }

    // 续跑入口阶段（agentType === resumeFrom）的 agent 从 payload 顶层解构输入
    // （characters/locations 等），而 resume 任务 payload 只带 resumeFrom +
    // stageResults——必须先把 stageResults 还原成顶层累积 payload 再执行，
    // 否则续跑阶段拿到空输入。resumeFrom 之后的阶段 payload 已按正常流程
    // 逐阶段合并，直接使用原始 payload，避免过期 stageResults 覆盖新结果。
    const agentPayload = resumeFrom && agentType === resumeFrom
      ? {
          ...resumePayload,
          ...mergeResumeStageResults((resumePayload.stageResults ?? {}) as Record<string, unknown>),
        }
      : task.payload;

    // 不打印 payload 全文：其中可能携带整包实体结果（大 JSON），只留定位信息。
    console.log(`[调度器] 正在处理 ${agentType} 任务 ${task.id}，书籍：${task.bookId}，resumeFrom：${resumeFrom ?? '无'}`);

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
      await this.finalizeRun(task.bookId, 'failed', `Unknown agent type: ${agentType}`);
      await this.finalizePipeline(task.bookId, 'failed');
      eventBus.emit({ type: 'error', bookId: task.bookId, stageId: agentType, message: `Unknown agent type: ${agentType}`, timestamp: Date.now() });
      return undefined;
    }

    const payloadBookId = (task.payload as { bookId?: string })?.bookId;
    if (!task.bookId || !payloadBookId) {
      console.error(`[调度器] 严重错误：任务 ${task.id} 缺少书籍编号！task.bookId=${task.bookId}，payload.bookId=${payloadBookId}`);
    }

    try {
      // 长阶段心跳：简介融合/提示词润色等纯内存 LLM 循环跑完才写一次任务行，
      // 不刷心跳会被 30 分钟超时回收误判卡死（改回 pending 重跑 → 再超时死循环）。
      // 执行期间每 5 分钟刷新 updatedAt，完成/失败后停止。
      const HEARTBEAT_INTERVAL_MS = 5 * 60_000;
      let result: unknown;
      let error: string | undefined;
      let attempts: number;
      const heartbeatTimer = setInterval(() => {
        void this.queue.heartbeat(task.id).catch((err) => {
          console.warn(`[调度器] 任务 ${task.id} 心跳刷新失败：`, err);
        });
      }, HEARTBEAT_INTERVAL_MS);
      heartbeatTimer.unref?.();
      try {
        ({ result, error, attempts } = await withRetry(
          () => agent(agentPayload)
        ));
      } finally {
        clearInterval(heartbeatTimer);
      }

      if (error) {
        if (attempts > DEFAULT_RETRY_CONFIG.maxRetries) {
          await this.queue.addToDeadLetter(task.id, error, attempts);
        } else {
          await this.queue.fail(task.id, error);
        }
        // 失败路径必须同步收敛运行会话：否则活动会话（含 QUEUED）残留，
        // 一书被「一书一活动运行」约束永久锁死，无法再新建运行。
        await this.finalizeRun(task.bookId, 'failed', error);
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
        const { characters: chars, locations: locs, items: entityItems, worldviews, totalCount } =
          summarizeExtractionResult(result);

        // 空结果守卫：三类实体全为空，几乎等价于配置/输入有问题（LLM 没返回、
        // 全被幻觉过滤、批次全失败）。此时不应静默标完成，否则前端会看到"已完成"
        // 但角色/场景页面为空（历史 bug）。判失败，保留旧实体不被清，让用户重试。
        if (totalCount === 0) {
          // 拼接 failedBatches 里的首个批次错误作为根因（如 LLM 404/401），
          // 避免用户只拿到"可能是配置问题"的猜测式文案而误判失败环节。
          const emptyMessage = buildEmptyExtractionMessage(result);
          await this.queue.fail(task.id, emptyMessage);
          await this.finalizeRun(task.bookId, 'failed', emptyMessage);
          await this.finalizePipeline(task.bookId, 'failed');
          eventBus.emit({
            type: 'error',
            bookId: task.bookId,
            stageId: agentType,
            message: emptyMessage,
            timestamp: Date.now(),
          });
          return undefined;
        }

        // 旧结果保护（实施包 D4）：不再先删后建。改为按稳定键对齐合并——
        // 人工审核状态/锁定字段不被覆盖；新结果缺失但人工过的实体保留并标
        // missingFromLatestRun；纯 AI 且不再出现的实体归档（archivedAt），不物理删除。
        // 发布在单事务内执行，中途失败旧实体保持可用。

        // 提示词阶段已按原文证据识别角色年龄变体，按角色名回写实体字段。
        const stageByName = new Map<string, { stages: string[]; primary: string }>();
        const rawCharacterPrompts = (result as { characterPrompts?: unknown }).characterPrompts;
        const characterPrompts = Array.isArray(rawCharacterPrompts)
          ? (rawCharacterPrompts as Array<{
              entityName?: string;
              variants?: Array<{ stage?: string; isPrimary?: boolean }>;
            }>)
          : [];
        for (const prompt of characterPrompts) {
          const variants = Array.isArray(prompt?.variants) ? prompt.variants : [];
          if (!prompt?.entityName || variants.length === 0) continue;
          const stages = variants.map((variant) => variant.stage).filter((stage): stage is string => Boolean(stage));
          if (stages.length === 0) continue;
          const primary = variants.find((variant) => variant.isPrimary)?.stage ?? stages[0];
          stageByName.set(prompt.entityName, { stages, primary });
        }

        // chars/locs/entityItems 已在上方统一解包并做过空结果守卫
        await publishEntitiesStable(bookId, { chars, locs, items: entityItems, worldviews }, stageByName);

        try {
          const specCount = await persistVisualSpecsFromResult(bookId, result);
          if (specCount > 0) {
            console.log(`[调度器] 已保存 ${specCount} 份视觉规格`);
          }
        } catch (err) {
          console.error(`[调度器] 保存书籍 ${bookId} 的视觉规格失败：`, err);
        }
      }

      if (nextAgent) {
        const taskPayload = task.payload && typeof task.payload === 'object' ? task.payload as Record<string, unknown> : {};
        const resultPayload = result && typeof result === 'object' ? result as Record<string, unknown> : {};

        // 阶段边界运行控制（实施包 D3）：当前阶段已完成（模型调用结束），
        // 此处检查运行是否被请求暂停/取消。
        const control = await checkRunControl(task.bookId);
        if (control === 'cancel') {
          console.log(`[调度器] 运行已被取消：书籍 ${task.bookId} 停止于 ${agentType} 之后，未发布候选结果`);
          // ISSUE-B4：与「已暂停后取消」路径对齐——清理残留 pending 任务，
          // 并按是否有已发布稳定结果把书籍状态收敛为 EXTRACTED / UPLOADED，
          // 否则书会永久停留 EXTRACTING，书库页开始/删除按钮被永久禁用。
          await prisma.task.updateMany({
            where: { bookId: task.bookId, status: 'pending' },
            data: { status: 'cancelled', cancelledAt: new Date() },
          });
          await BookRepository.settleStatusAfterCancel(task.bookId);
          eventBus.emit({ type: 'error', bookId: task.bookId, message: '运行已取消，未发布结果；最近稳定结果保持不变', timestamp: Date.now() });
          return task.id;
        }
        if (control === 'pause') {
          // 不领取下一阶段：把续跑信息（下一阶段 + 已完成阶段结果）存进运行 manifest
          const pausedSession = await ExtractionSessionRepository.findActiveByBook(task.bookId) as { id: string } | null;
          if (pausedSession) {
            await ExtractionSessionRepository.markPaused(
              pausedSession.id,
              nextAgent,
              { ...taskPayload, ...resultPayload, bookId: task.bookId, userId: taskPayload.userId },
            );
          }
          console.log(`[调度器] 运行已暂停：书籍 ${task.bookId} 将从 ${nextAgent} 恢复`);
          eventBus.emit({ type: 'error', bookId: task.bookId, message: `运行已暂停，可从「${TaskDispatcher.STAGE_NAMES[nextAgent] ?? nextAgent}」恢复`, timestamp: Date.now() });
          return task.id;
        }

        await this.queue.enqueue({
          bookId: task.bookId,
          agentType: nextAgent,
          payload: { ...taskPayload, ...resultPayload, bookId: task.bookId, userId: taskPayload.userId },
          status: 'pending',
        });
        return await this.processNext(nextAgent);
      }

      // Pipeline completed successfully
      // 先收敛运行/书籍状态并广播完成事件，再落盘最终摘要。stage_complete(reviewer)
      // 一到前端就显示"提取完成"并跳转审核页；若此处先做十几个产物文件的全量
      // 读写（读库 + stringify + 对象存储双写），同进程的实体/产物接口会被
      // 挤慢，用户在审核页长时间看到空列表、空提示词（历史 bug）。
      await this.finalizeRun(task.bookId, 'completed');
      await this.finalizePipeline(task.bookId, 'completed');
      eventBus.emit({ type: 'completed', bookId: task.bookId, progress: 100, timestamp: Date.now() });
      try {
        await writePipelineFinalSummary(task.bookId, task.payload, result);
      } catch (err) {
        // 摘要落盘失败不回滚已完成的运行；前端产物接口会短轮询补齐
        console.error(`[调度器] 写入最终运行摘要失败（书籍 ${task.bookId}）：`, err);
      }
      return task.id;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.queue.fail(task.id, errorMessage);
      await this.finalizeRun(task.bookId, 'failed', errorMessage);
      await this.finalizePipeline(task.bookId, 'failed');
      eventBus.emit({ type: 'error', bookId: task.bookId, stageId: agentType, message: errorMessage, timestamp: Date.now() });
      return undefined;
    }
  }

  /** 运行收敛（实施包 D1/D4）：把 ExtractionSession 置终态并在成功时发布为当前稳定结果。 */
  private async finalizeRun(bookId: string, outcome: 'completed' | 'failed', reason?: string): Promise<void> {
    try {
      const active = await ExtractionSessionRepository.findActiveByBook(bookId) as { id: string } | null;
      if (!active) return;
      if (outcome === 'completed') {
        // 发布为当前稳定结果：事务内完成 session 状态 + book 指针（发布失败旧结果仍在）
        await prisma.$transaction(async (tx) => {
          const now = new Date();
          await tx.extractionSession.update({
            where: { id: active.id },
            data: { status: 'COMPLETED', completedAt: now, promotedAt: now },
          });
          await tx.book.update({
            where: { id: bookId },
            data: { currentExtractionSessionId: active.id },
          });
        });
      } else {
        await ExtractionSessionRepository.markFailed(active.id, reason ?? '提取失败');
      }
    } catch (err) {
      console.error(`[调度器] 收敛运行状态失败（书籍 ${bookId}）：`, err);
    }
  }

  private async finalizePipeline(bookId: string, outcome: 'completed' | 'failed') {
    try {
      await BookRepository.updateStatus(bookId, outcome === 'completed' ? 'EXTRACTED' : 'FAILED');
    } catch (err) {
      console.error(`[调度器] 更新书籍 ${bookId} 状态失败：`, err);
    }
  }

  async getTaskStatus(taskId: string): Promise<Task | null> {
    return this.queue.getStatus(taskId);
  }
}

// ═══ 稳定发布（实施包 D4）═══

/** 实体稳定键：按归一化名称生成，跨运行保持不变。 */
function deriveStableKey(name: string): string {
  return `n:${name.trim().toLowerCase()}`;
}

interface PublishableRow {
  name: string;
  [key: string]: unknown;
}

/** 用户锁定字段：这些字段名不随重跑覆盖。 */
const LOCKABLE_FIELDS = ['name', 'aliases', 'description', 'category', 'tier'] as const;

function stripLocked(data: Record<string, unknown>, lockedFields: unknown): Record<string, unknown> {
  const locked = Array.isArray(lockedFields) ? (lockedFields as string[]) : [];
  const out = { ...data };
  for (const f of locked) delete out[f];
  return out;
}

/**
 * 按 stableKey 对齐新旧实体并在单事务内发布：
 * - 命中旧实体：更新非锁定字段；保留人工审核状态与 reviewSource，version+1
 * - 新实体：创建（stableKey=归一化名称，PENDING/AI）
 * - 新结果缺失：人工过（USER/APPROVED/REJECTED）保留并标 missingFromLatestRun；纯 AI 归档
 * 发布失败抛错（旧实体保持原样，由上层标记运行失败）。
 */
async function publishEntitiesStable(
  bookId: string,
  incoming: {
    chars: PublishableRow[];
    locs: PublishableRow[];
    items: PublishableRow[];
    worldviews: PublishableRow[];
  },
  stageByName: Map<string, { stages: string[]; primary: string }>,
): Promise<void> {
  const now = new Date();

  // 入库前别名统一清洗（最后一道防线，覆盖所有阶段的别名来源——
  // 提取出口的过滤拦不住消解/融合阶段新产生的脏别名）：
  // 1) 与本轮其它实体的正名相同 → 剔除（如"张铁.七绝上人"），两者保持独立交人工决策
  // 2) 集体称谓（"三位师叔"类）→ 剔除，避免与成员个体生成错误合并候选
  // 3) 与自身正名相同 → 剔除
  const allPublishNames = new Set<string>();
  for (const list of [incoming.chars, incoming.locs, incoming.items, incoming.worldviews]) {
    for (const row of list) if (row.name) allPublishNames.add(String(row.name));
  }
  let cleanedAliasCount = 0;
  const cleanAliases = (selfName: string, aliases: unknown): string[] => {
    if (!Array.isArray(aliases)) return [];
    const cleaned = aliases
      .map((a) => String(a))
      .filter((a) => {
        if (!a || a === selfName) return false;
        if (allPublishNames.has(a)) { cleanedAliasCount++; return false; }
        if (isCollectiveCharacterAlias(a)) { cleanedAliasCount++; return false; }
        return true;
      });
    return [...new Set(cleaned)];
  };

  const charData = (c: PublishableRow) => ({
    name: c.name,
    aliases: cleanAliases(c.name, c.aliases),
    description: (c.description as string) || null,
    confidence: (c.confidence as number) || 0.5,
    chapterRef: (c.chapterRef as string) || null,
    firstChapter: (c.firstChapter as number) ?? null,
    lastChapter: (c.lastChapter as number) ?? null,
    chapterAppearances: (c.chapterAppearances as number[]) ?? [],
    mentionCount: (c.mentionCount as number) ?? 0,
    dialogueCount: (c.dialogueCount as number) ?? 0,
    coCharacters: (c.coCharacters as string[]) ?? [],
    firstMentionSnippet: (c.firstMentionSnippet as string) || null,
    outfits: Array.isArray(c.outfits) ? c.outfits : [],
    ageStages: stageByName.get(c.name)?.stages ?? [],
    primaryAgeStage: stageByName.get(c.name)?.primary ?? null,
  });
  const locData = (l: PublishableRow) => ({
    name: l.name,
    aliases: cleanAliases(l.name, l.aliases),
    description: (l.description as string) || null,
    confidence: (l.confidence as number) || 0.7,
    chapterRef: (l.chapterRef as string) || null,
    importanceScore: (l.importanceScore as number) ?? 0,
    tier: (l.tier as string) ?? 'candidate',
    storyScore: (l.storyScore as number) ?? 0,
    productionScore: (l.productionScore as number) ?? 0,
    pillarCausal: (l.pillarCausal as number) ?? 0,
    pillarUniqueness: (l.pillarUniqueness as number) ?? 0,
    pillarTransition: (l.pillarTransition as number) ?? 0,
    mentionCount: (l.mentionCount as number) ?? 0,
    firstChapter: (l.firstChapter as number) ?? null,
    lastChapter: (l.lastChapter as number) ?? null,
    chapterAppearances: (l.chapterAppearances as number[]) ?? [],
    firstMentionSnippet: (l.firstMentionSnippet as string) || null,
  });
  const itemData = (i: PublishableRow) => ({
    ...locData(i),
    category: (i.category as string) || 'other',
    owners: Array.isArray(i.owners) ? i.owners : [],
  });
  const worldviewData = (w: PublishableRow) => ({
    name: w.name,
    aliases: cleanAliases(w.name, w.aliases),
    category: (w.category as string) || 'worldview',
    description: (w.description as string) || null,
    confidence: (w.confidence as number) || 0.7,
    chapterRef: (w.chapterRef as string) || null,
    importanceScore: (w.importanceScore as number) ?? 0,
    tier: (w.tier as string) ?? 'candidate',
    mentionCount: (w.mentionCount as number) ?? 0,
    firstChapter: (w.firstChapter as number) ?? null,
    lastChapter: (w.lastChapter as number) ?? null,
    chapterAppearances: (w.chapterAppearances as number[]) ?? [],
  });

  type ModelKey = 'character' | 'location' | 'item' | 'worldviewSetting';
  const groups: Array<{
    model: ModelKey;
    rows: PublishableRow[];
    map: (row: PublishableRow) => Record<string, unknown>;
  }> = [
    { model: 'character', rows: incoming.chars, map: charData },
    { model: 'location', rows: incoming.locs, map: locData },
    { model: 'item', rows: incoming.items, map: itemData },
    { model: 'worldviewSetting', rows: incoming.worldviews, map: worldviewData },
  ];

  await prisma.$transaction(async (tx) => {
    for (const { model, rows, map } of groups) {
      const delegate = (tx as unknown as Record<ModelKey, {
        findMany(args: unknown): Promise<Array<Record<string, unknown>>>;
        create(args: { data: unknown }): Promise<unknown>;
        update(args: { where: { id: string }; data: unknown }): Promise<unknown>;
        updateMany(args: { where: unknown; data: unknown }): Promise<unknown>;
      }>)[model];

      const existing = await delegate.findMany({ where: { bookId } });
      const byStable = new Map<string, Record<string, unknown>>();
      for (const row of existing) {
        const key = (row.stableKey as string) || deriveStableKey(String(row.name));
        if (!byStable.has(key)) byStable.set(key, row);
      }

      const seenKeys = new Set<string>();
      for (const row of rows) {
        const key = deriveStableKey(row.name);
        seenKeys.add(key);
        const data = map(row);
        const old = byStable.get(key);
        if (old) {
          // 命中旧实体：保留人工审核状态/来源/稳定键；锁定字段不覆盖
          const merged = stripLocked(data, old.lockedFields);
          const userTouched = old.reviewSource === 'USER' || old.status === 'APPROVED' || old.status === 'REJECTED';
          await delegate.update({
            where: { id: old.id as string },
            data: {
              ...merged,
              ...(userTouched
                ? { status: old.status, reviewSource: old.reviewSource }
                : { status: 'PENDING', reviewSource: 'AI' }),
              stableKey: old.stableKey ?? key,
              version: { increment: 1 },
              missingFromLatestRun: false,
              archivedAt: null,
            },
          });
        } else {
          await delegate.create({
            data: {
              bookId,
              ...data,
              status: 'PENDING',
              reviewSource: 'AI',
              stableKey: key,
              missingFromLatestRun: false,
            },
          });
        }
      }

      // 新结果不再出现的旧实体
      for (const [key, old] of byStable) {
        if (seenKeys.has(key)) continue;
        const userTouched = old.reviewSource === 'USER' || old.status === 'APPROVED' || old.status === 'REJECTED';
        if (userTouched) {
          // 人工审核过：保留并提示风险（新结果缺失）
          await delegate.update({
            where: { id: old.id as string },
            data: { missingFromLatestRun: true },
          });
        } else if (!old.archivedAt) {
          // 纯 AI 且不再出现：归档（不物理删除）
          await delegate.update({
            where: { id: old.id as string },
            data: { archivedAt: now, missingFromLatestRun: true },
          });
        }
      }
    }
  });
  if (cleanedAliasCount > 0) {
    console.log(`[入库] 已剔除 ${cleanedAliasCount} 个脏别名（撞其它实体正名或集体称谓）`);
  }

  // 入库后清理本轮残留（旧 version 视觉设定 + 本轮归档实体），防止重跑逐轮累积；
  // 清理失败不影响主管道（下一轮入库或维护脚本会再次收敛）
  try {
    const residue = await createExtractionResidueCleanup(prisma).cleanup(bookId);
    if (residue.supersededSpecs + residue.archivedEntities > 0) {
      console.log(
        `[入库] 已清理本轮残留：旧版视觉设定 ${residue.supersededSpecs} 行、归档实体 ${residue.archivedEntities} 个（孤儿图片 ${residue.orphanImages} 条）`
      );
    }
  } catch (err) {
    console.warn('[入库] 残留清理失败（不影响本次提取结果）：', err instanceof Error ? err.message : String(err));
  }
}

/** 阶段边界运行控制检查（实施包 D3）：返回 pause/cancel/continue。 */
async function checkRunControl(bookId: string): Promise<'pause' | 'cancel' | 'continue'> {
  try {
    const session = await ExtractionSessionRepository.findActiveByBook(bookId) as
      | { status: string; id: string }
      | null;
    if (!session) return 'continue';
    if (session.status === 'CANCELLING') {
      await ExtractionSessionRepository.markCancelled(session.id);
      return 'cancel';
    }
    if (session.status === 'PAUSING' || session.status === 'PAUSED') {
      return 'pause';
    }
    if (session.status === 'QUEUED') {
      // 首个阶段开始执行时把运行置为 RUNNING
      await ExtractionSessionRepository.markRunning(session.id);
    }
    return 'continue';
  } catch (err) {
    console.error(`[调度器] 检查运行控制失败（书籍 ${bookId}，按继续处理）：`, err);
    return 'continue';
  }
}
