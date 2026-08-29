/**
 * 提取运行服务（实施包 D1/D3/D5）。
 *
 * 运行（ExtractionSession）是提取的正式批次载体：
 * - 创建：校验版本确认/无活动运行/模型可用 → 建会话（含预算估算）→ 启动管线
 * - 暂停：置 PAUSING，调度器在当前阶段完成后停在其边界并保存续跑信息
 * - 恢复：从 manifest.resumeFrom 重新入队（复用断点续传机制）
 * - 取消：置 CANCELLING，调度器在阶段边界终止；已取消运行不能续跑，需新建
 */
import {
  BookRepository,
  TaskRepository,
  ExtractionSessionRepository,
  prisma,
} from '@qunxiang/storage';
import { ConflictError, NotFoundError } from '../lib/errors.js';
import { getDefaultProvider, getApiKeyCount } from '@qunxiang/llm';
import { getSharedAssetSourceResolver } from '@qunxiang/storage';
import { startExtraction, resumeExtraction } from './extraction.service.js';

export interface CreateRunOptions {
  maxCalls?: number;
  maxTokens?: number;
}

export interface RunEstimates {
  /** 原文字数（去空白） */
  inputChars: number;
  /** 预计模型调用次数（批次 + 补写 + 提示词） */
  estimatedCalls: number;
  /** 队列前方活动运行数 */
  queuedAhead: number;
  /** 历史平均耗时（毫秒），无历史为 null */
  historicalDurationMs: number | null;
  /** 本次调用上限 */
  maxCalls: number;
  /** 本次 Token 上限 */
  maxTokens: number | null;
}

/** 启动前估算（实施包 D5）：字数 / 调用次数 / 队列前方 / 历史耗时 / 上限。 */
export async function estimateRun(bookId: string, ownerId: string, opts: CreateRunOptions = {}): Promise<RunEstimates> {
  const book = await BookRepository.findOwnedById(bookId, ownerId);
  if (!book) throw new NotFoundError('书籍不存在或无权访问');

  // 原文读取失败（旧书本机文件缺失等）时按 0 字估算，接口保持可用
  let content = '';
  try {
    content = await getSharedAssetSourceResolver().readSourceText(book);
  } catch {
    content = '';
  }
  const inputChars = content ? content.replace(/\s/g, '').length : Math.max(book.fileSize ?? 0, 0);
  // 估算：抽取每 ~2.5 万字一批（LLM 批次），叠加描述补写与提示词约 40% 额外调用
  const extractionBatches = Math.max(1, Math.ceil(inputChars / 25_000));
  const estimatedCalls = Math.ceil(extractionBatches * 1.4);

  const queuedAhead = await ExtractionSessionRepository.countActiveAhead(bookId);

  // 历史耗时：该书（或全局）已完成运行 startedAt→completedAt 的平均
  const history = await prisma.$queryRaw<Array<{ avgMs: bigint | null }>>`
    SELECT AVG(EXTRACT(EPOCH FROM ("completedAt" - "startedAt")) * 1000) AS "avgMs"
    FROM "ExtractionSession"
    WHERE "status" = 'COMPLETED' AND "startedAt" IS NOT NULL AND "completedAt" IS NOT NULL
  `;
  const avgMs = history[0]?.avgMs != null ? Number(history[0].avgMs) : null;

  return {
    inputChars,
    estimatedCalls,
    queuedAhead,
    historicalDurationMs: avgMs,
    maxCalls: opts.maxCalls ?? Math.max(estimatedCalls * 2, 20),
    maxTokens: opts.maxTokens ?? null,
  };
}

/** 创建并启动一次提取运行。 */
export async function createRun(bookId: string, ownerId: string, opts: CreateRunOptions = {}): Promise<{ runId: string; taskId: string }> {
  const book = await BookRepository.findOwnedById(bookId, ownerId);
  if (!book) throw new NotFoundError('书籍不存在或无权访问');

  // 版本确认门禁（与旧接口一致）
  if (book.preprocessConfirmedRevision !== book.sourceRevision) {
    throw new ConflictError('原文或噪声设置已变更，请先在「章节」页确认当前版本后再提取');
  }

  // 一书一活动运行（数据库部分唯一索引兜底）
  const active = await ExtractionSessionRepository.findActiveByBook(bookId);
  if (active) {
    throw new ConflictError('该书已有进行中的运行，请先等待完成、暂停或取消');
  }

  const provider = await getDefaultProvider();
  const estimates = await estimateRun(bookId, ownerId, opts);

  let runId: string;
  try {
    const { id } = await ExtractionSessionRepository.create({
      bookId,
      userId: ownerId,
      kind: 'LIVE',
      status: 'QUEUED',
      sourceRevision: book.sourceRevision ?? 0,
      estimatedInputChars: BigInt(estimates.inputChars),
      estimatedCalls: estimates.estimatedCalls,
      maxCalls: estimates.maxCalls,
      maxTokens: estimates.maxTokens ?? undefined,
      manifest: {
        provider: provider.name,
        apiKeys: getApiKeyCount(),
        estimatedAt: new Date().toISOString(),
      },
    });
    runId = id;
  } catch (err) {
    // 并发创建撞上「一书一活动运行」部分唯一索引：语义与前置检查一致，返回 409
    if ((err as { code?: string }).code === 'P2002') {
      throw new ConflictError('该书已有进行中的运行，请先等待完成、暂停或取消');
    }
    throw err;
  }

  // 启动管线（复用旧入口的全部校验与清理逻辑）。
  // 启动失败（如模型未配置）必须把会话收敛为 FAILED——否则 QUEUED 会话属于
  // 活动态，一书被唯一索引锁死，后续 createRun 永远 409。
  try {
    const { taskId } = await startExtraction(bookId, ownerId);
    // 任务绑定运行（实施包第五节 Task.extractionSessionId）
    await prisma.task.updateMany({ where: { id: taskId }, data: { extractionSessionId: runId } });
    return { runId, taskId };
  } catch (err) {
    await ExtractionSessionRepository.markFailed(
      runId,
      err instanceof Error ? err.message : String(err),
    ).catch(() => {
      // 收敛失败仅记录，不掩盖原始错误
    });
    throw err;
  }
}

/** 运行详情：会话 + 阶段任务。 */
export async function getRun(bookId: string, ownerId: string, runId: string) {
  const book = await BookRepository.findOwnedById(bookId, ownerId);
  if (!book) throw new NotFoundError('书籍不存在或无权访问');
  const run = await prisma.extractionSession.findFirst({
    where: { id: runId, bookId },
    orderBy: { createdAt: 'desc' },
  });
  if (!run) throw new NotFoundError('运行不存在');
  const runJson = serializeRun(run);
  const tasks = await prisma.task.findMany({
    where: { bookId, extractionSessionId: runId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, agentType: true, status: true, startedAt: true, completedAt: true, failedAt: true, error: true },
  });
  return { run: runJson, tasks };
}

/** BigInt 字段转字符串，保证 JSON 可序列化。 */
function serializeRun<T extends { estimatedInputChars?: bigint | null }>(run: T): T & { estimatedInputChars?: string | null } {
  return {
    ...run,
    ...(run.estimatedInputChars != null ? { estimatedInputChars: String(run.estimatedInputChars) } : {}),
  };
}

/** 当前活动运行（无则返回最近一次）。 */
export async function getCurrentRun(bookId: string, ownerId: string) {
  const book = await BookRepository.findOwnedById(bookId, ownerId);
  if (!book) throw new NotFoundError('书籍不存在或无权访问');
  const active = await prisma.extractionSession.findFirst({
    where: { bookId, status: { in: ['QUEUED', 'RUNNING', 'PAUSING', 'PAUSED', 'CANCELLING'] } },
    orderBy: { createdAt: 'desc' },
  });
  const runRow = active
    ?? (await prisma.extractionSession.findFirst({ where: { bookId }, orderBy: { createdAt: 'desc' } }));
  if (!runRow) return { run: null, tasks: [] };
  const run = serializeRun(runRow);
  const tasks = await prisma.task.findMany({
    where: { bookId, extractionSessionId: run.id },
    orderBy: { createdAt: 'asc' },
    select: { id: true, agentType: true, status: true, startedAt: true, completedAt: true, failedAt: true, error: true },
  });
  return { run, tasks };
}

/** 请求暂停：当前模型调用完成后调度器停在阶段边界。 */
export async function pauseRun(bookId: string, ownerId: string, runId: string): Promise<void> {
  const { run } = await getRun(bookId, ownerId, runId);
  if (!['QUEUED', 'RUNNING', 'PAUSING'].includes(run.status)) {
    throw new ConflictError('该运行不在可暂停状态');
  }
  // 条件更新：检查与写入之间运行可能恰好完成/取消，此时不得把终态覆写成 PAUSING
  //（否则会话重新变回活动态，一书被永久锁死）。
  const updated = await prisma.extractionSession.updateMany({
    where: { id: run.id, status: { in: ['QUEUED', 'RUNNING', 'PAUSING'] } },
    data: { status: 'PAUSING', pauseRequestedAt: new Date() },
  });
  if (updated.count === 0) {
    throw new ConflictError('该运行已结束，无法暂停');
  }
}

/** 恢复：从 manifest.resumeFrom 续跑（复用断点续传机制）。 */
export async function resumeRun(bookId: string, ownerId: string, runId: string): Promise<{ resumedFrom: string }> {
  const { run } = await getRun(bookId, ownerId, runId);
  if (run.status !== 'PAUSED') {
    throw new ConflictError('仅已暂停的运行可以恢复');
  }
  // 条件更新：与并发取消竞态时（PAUSED→CANCELLING/CANCELLED），不得把已取消
  // 的运行复活成 RUNNING。
  const resumed = await ExtractionSessionRepository.markResumed(run.id);
  if (!resumed) {
    throw new ConflictError('该运行不在可恢复状态');
  }
  const manifest = (run.manifest ?? {}) as { resumeFrom?: string; stageResults?: unknown };
  if (manifest.resumeFrom) {
    await resumeExtraction(bookId, ownerId, {
      resumeFrom: manifest.resumeFrom as Parameters<typeof resumeExtraction>[2] extends infer R ? R extends { resumeFrom: infer F } ? F : never : never,
      stageResults: (manifest.stageResults ?? {}) as Record<string, unknown>,
    });
    return { resumedFrom: manifest.resumeFrom };
  }
  // 无续跑信息（极早期暂停）：整个运行重跑
  const { taskId } = await startExtraction(bookId, ownerId);
  await prisma.task.updateMany({ where: { id: taskId }, data: { extractionSessionId: run.id } });
  return { resumedFrom: 'extractor' };
}

/** 请求取消：调度器在阶段边界终止；不删除最近稳定结果。 */
export async function cancelRun(bookId: string, ownerId: string, runId: string): Promise<void> {
  const { run } = await getRun(bookId, ownerId, runId);
  if (['CANCELLED', 'COMPLETED', 'FAILED'].includes(run.status)) {
    throw new ConflictError('该运行已结束，不能取消');
  }
  if (run.status === 'PAUSED') {
    // 已暂停：直接取消（无在途阶段）
    await ExtractionSessionRepository.markCancelled(run.id);
    // 清理该书残留 pending 任务（取消 pending 任务）
    await prisma.task.updateMany({
      where: { bookId, status: 'pending' },
      data: { status: 'cancelled', cancelledAt: new Date() },
    });
    // ISSUE-B4：与边界取消路径同一规则——有已发布稳定结果回「已提取」，否则回「待提取」
    await BookRepository.settleStatusAfterCancel(bookId);
    return;
  }
  await ExtractionSessionRepository.markCancelling(run.id);
}

/** 供 SSE 使用的会话状态文本。 */
export async function describeRun(runId: string): Promise<string> {
  const run = await prisma.extractionSession.findUnique({ where: { id: runId } });
  return run ? `运行 ${run.id.slice(0, 8)} 状态：${run.status}` : '运行不存在';
}

