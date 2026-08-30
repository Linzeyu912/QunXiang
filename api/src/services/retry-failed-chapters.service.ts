/**
 * 失败章节增量补跑（实施：提取丢章的"补跑"入口）。
 *
 * 流程：
 * 1. 读该书最后一次运行的 extractor 任务 result.failedBatches，展开成章节号集合
 * 2. 用与主提取完全一致的解析链（readSourceText → parseTxtEnhanced，跳过 prescan）
 *    切分章节并过滤出失败章节
 * 3. extractEntities 只跑这些章节（自带批次重试 + 拆章降级容错）
 * 4. 增量合并入库：
 *    - 命中旧实体（stableKey）：mentionCount/dialogueCount 累加、chapterAppearances
 *      /aliases 并集、first/lastChapter 扩展、confidence 取大；**不覆盖已融合的
 *      description**，不动人工审核状态——与全量入库（publishEntitiesStable）的
 *      覆盖式语义不同，补跑是纯增量
 *    - 新实体：插入 PENDING（AI 来源），带 extractor 粗描述
 *    - 不做全量替换的 missingFromLatestRun/归档处理
 * 5. 全部成功后清空该任务 result 里的 failedBatches，进度页丢章警告消失
 *
 * 新实体的简介融合/视觉描述/提示词不在本次补齐（需要全书上下文，成本≈全量重跑），
 * 实体以待审核状态进入审核页，描述为提取粗稿；如需完整产物可全量重新提取。
 */
import { prisma, BookRepository, getSharedAssetSourceResolver, TaskRepository } from '@qunxiang/storage';
import { parseTxtEnhanced } from '@qunxiang/import';
import { createExtractor } from '@qunxiang/extractors';
import { inferItemCategory, calibrateConfidence } from '@qunxiang/core';
import { NotFoundError, ConflictError } from '../lib/errors.js';
import type { Chapter } from '@qunxiang/extractors';

export interface RetryFailedChaptersResult {
  retriedChapters: number[];
  newEntities: number;
  mergedEntities: number;
  stillFailedChapters: number[];
  message: string;
}

interface FailedBatchRecord {
  chapterFrom?: number;
  chapterTo?: number;
}

/** 从最后一次 extractor 任务的 result 里展开失败章节号（闭区间并集） */
export async function collectFailedChapterNumbers(bookId: string): Promise<number[]> {
  const tasks = await TaskRepository.findByBookId(bookId);
  const extractorTask = tasks.find((t) => t.agentType === 'extractor' && t.status === 'completed');
  if (!extractorTask) return [];
  const result = extractorTask.result as { failedBatches?: FailedBatchRecord[] } | undefined;
  if (!Array.isArray(result?.failedBatches) || result.failedBatches.length === 0) return [];

  const chapters = new Set<number>();
  for (const b of result.failedBatches) {
    const from = typeof b.chapterFrom === 'number' ? b.chapterFrom : undefined;
    const to = typeof b.chapterTo === 'number' ? b.chapterTo : undefined;
    if (from == null && to == null) continue;
    const lo = from ?? to!;
    const hi = to ?? from!;
    for (let i = lo; i <= hi; i++) chapters.add(i);
  }
  return [...chapters].sort((a, b) => a - b);
}

/** 清空 extractor 任务 result 里的 failedBatches（补跑成功后调用），返回是否更新 */
async function clearFailedBatches(bookId: string): Promise<boolean> {
  const tasks = await TaskRepository.findByBookId(bookId);
  const extractorTask = tasks.find((t) => t.agentType === 'extractor' && t.status === 'completed');
  if (!extractorTask) return false;
  const result = extractorTask.result as Record<string, unknown> | undefined;
  if (!result || !Array.isArray(result.failedBatches) || result.failedBatches.length === 0) return false;
  delete result.failedBatches;
  await prisma.task.update({
    where: { id: extractorTask.id },
    data: { result: result as object },
  });
  return true;
}

type EntityModel = 'character' | 'location' | 'item' | 'worldviewSetting';

/** 数值型字段累加、数组字段并集、区间字段扩展的增量合并（纯增量，不覆盖描述与审核状态）。
 * 只合并 fresh 行里实际存在的字段——各实体模型的字段集不同（如 owners 仅道具有），
 * 无中生有会被 Prisma 校验拒绝。 */
function mergeIncremental(
  oldRow: Record<string, unknown>,
  fresh: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...fresh };
  // 正名保持库内既有：别名命中合并时，补跑的简称/别名不能反向覆盖正名
  merged.name = oldRow.name;
  for (const key of ['mentionCount', 'dialogueCount'] as const) {
    if (!(key in fresh)) continue;
    const oldValue = typeof oldRow[key] === 'number' ? (oldRow[key] as number) : 0;
    merged[key] = oldValue + (typeof fresh[key] === 'number' ? (fresh[key] as number) : 0);
  }
  for (const key of ['chapterAppearances', 'aliases', 'coCharacters', 'owners'] as const) {
    if (!(key in fresh)) continue;
    const oldList = Array.isArray(oldRow[key]) ? (oldRow[key] as unknown[]) : [];
    const freshList = Array.isArray(fresh[key]) ? (fresh[key] as unknown[]) : [];
    merged[key] = [...new Set([...oldList, ...freshList])].sort((a, b) =>
      typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b))
    );
  }
  for (const key of ['firstChapter'] as const) {
    const oldValue = typeof oldRow[key] === 'number' ? (oldRow[key] as number) : undefined;
    const freshValue = typeof fresh[key] === 'number' ? (fresh[key] as number) : undefined;
    merged[key] = oldValue != null && freshValue != null ? Math.min(oldValue, freshValue) : (oldValue ?? freshValue ?? null);
  }
  for (const key of ['lastChapter'] as const) {
    const oldValue = typeof oldRow[key] === 'number' ? (oldRow[key] as number) : undefined;
    const freshValue = typeof fresh[key] === 'number' ? (fresh[key] as number) : undefined;
    merged[key] = oldValue != null && freshValue != null ? Math.max(oldValue, freshValue) : (oldValue ?? freshValue ?? null);
  }
  if (typeof oldRow.confidence === 'number') {
    merged.confidence = Math.max(oldRow.confidence as number, typeof fresh.confidence === 'number' ? (fresh.confidence as number) : 0);
  }
  // 已融合的描述优先；只有旧描述为空才采用补跑粗稿
  if (typeof oldRow.description === 'string' && (oldRow.description as string).trim()) {
    merged.description = oldRow.description;
  }
  // 审核状态与来源保持旧值（人工成果不回退）
  delete merged.status;
  delete merged.reviewSource;
  delete merged.stableKey;
  return merged;
}

/** 补跑实体增量入库。返回 { created, merged } 计数。 */
async function mergeEntitiesIntoDb(
  bookId: string,
  incoming: Array<{ model: EntityModel; name: string; row: Record<string, unknown> }>,
): Promise<{ created: number; merged: number }> {
  let created = 0;
  let mergedCount = 0;
  const byModel = new Map<EntityModel, typeof incoming>();
  for (const entry of incoming) {
    const list = byModel.get(entry.model) ?? [];
    list.push(entry);
    byModel.set(entry.model, list);
  }

  for (const [model, entries] of byModel) {
    const delegate = (prisma as unknown as Record<EntityModel, {
      findMany(args: unknown): Promise<Array<Record<string, unknown>>>;
      create(args: { data: unknown }): Promise<unknown>;
      update(args: { where: { id: string }; data: unknown }): Promise<unknown>;
    }>)[model];

    const existing = await delegate.findMany({ where: { bookId } });
    // 合并键包含旧实体的正名与别名（首见优先，与全量入库 stableKey 的语义一致）：
    // 补跑提取常用简称/别名指称呼叫实体（库内"七玄门魁梧汉子"、补跑提出"汉子"），
    // 仅按正名匹配会错误创建重复实体
    const byKey = new Map<string, Record<string, unknown>>();
    for (const row of existing) {
      if (!byKey.has(String(row.name))) byKey.set(String(row.name), row);
      for (const alias of Array.isArray(row.aliases) ? (row.aliases as unknown[]) : []) {
        const aliasKey = String(alias);
        if (aliasKey && !byKey.has(aliasKey)) byKey.set(aliasKey, row);
      }
    }
    for (const entry of entries) {
      const old = byKey.get(entry.name);
      if (old) {
        await delegate.update({
          where: { id: old.id as string },
          data: mergeIncremental(old, entry.row),
        });
        mergedCount++;
      } else {
        await delegate.create({
          data: {
            bookId,
            ...entry.row,
            status: 'PENDING',
            reviewSource: 'AI',
            missingFromLatestRun: false,
          },
        });
        created++;
      }
    }
  }
  return { created, merged: mergedCount };
}

export async function retryFailedChapters(bookId: string, ownerId: string): Promise<RetryFailedChaptersResult> {
  const book = await BookRepository.findOwnedById(bookId, ownerId);
  if (!book) throw new NotFoundError('书籍不存在或无权访问');

  // 与 startExtraction 相同的互斥保护：有进行中任务时拒绝
  const tasks = await TaskRepository.findByOwnedBookId(bookId, ownerId);
  if (tasks.some((t) => t.status === 'pending' || t.status === 'running')) {
    throw new ConflictError('该书正在提取中，请等待当前运行结束');
  }

  const failedChapters = await collectFailedChapterNumbers(bookId);
  if (failedChapters.length === 0) {
    return { retriedChapters: [], newEntities: 0, mergedEntities: 0, stillFailedChapters: [], message: '没有需要补跑的失败章节' };
  }

  // 与主提取一致的解析链（不传 bookId → 跳过 prescan，无中间产物写入）
  const content = await getSharedAssetSourceResolver().readSourceText(book);
  const enhanced = await parseTxtEnhanced(content, book.title, {});
  const allChapters: Chapter[] = enhanced.chapters.map((ch) => ({
    index: ch.index,
    title: ch.title,
    content: ch.content,
  }));
  const chapterSet = new Set(failedChapters);
  const targetChapters = allChapters.filter((ch) => chapterSet.has(ch.index));
  if (targetChapters.length === 0) {
    throw new Error(`失败章节（${failedChapters.join('、')}）在当前原文中不存在，原文可能已变更，请全量重新提取`);
  }

  const extractEntities = createExtractor({});
  const entityResult = await extractEntities(enhanced.title, targetChapters);

  // 仍失败的章节（重试 + 拆章降级后）
  const stillFailed = new Set<number>();
  for (const b of entityResult.failedBatches) {
    for (const ch of b.batch) stillFailed.add(ch.index);
  }

  // 幻觉过滤：0 提及 + 0 对白的角色是 LLM 编造
  const characters = entityResult.characters.filter((c) => (c.mentionCount ?? 0) > 0 || (c.dialogueCount ?? 0) > 0);
  // 新实体的置信度走与主提取一致的证据校准（补跑只有本批证据，校准后偏保守是合理语义）
  const totalChapters = allChapters.length;
  const incoming: Array<{ model: EntityModel; name: string; row: Record<string, unknown> }> = [
    ...characters.map((c) => ({
      model: 'character' as EntityModel,
      name: c.name,
      row: {
        name: c.name,
        aliases: Array.isArray(c.aliases) ? c.aliases : [],
        description: c.description || null,
        confidence: calibrateConfidence(c.confidence ?? 0.5, {
          mentionCount: c.mentionCount ?? 0,
          chapterCount: (c.chapterAppearances ?? []).length,
          dialogueCount: c.dialogueCount ?? 0,
          totalChapters,
        }),
        chapterRef: c.chapterRef ?? null,
        firstChapter: c.firstChapter ?? null,
        lastChapter: c.lastChapter ?? null,
        chapterAppearances: c.chapterAppearances ?? [],
        mentionCount: c.mentionCount ?? 0,
        dialogueCount: c.dialogueCount ?? 0,
        coCharacters: Array.isArray(c.coCharacters) ? c.coCharacters : [],
        outfits: Array.isArray(c.outfits) ? c.outfits : [],
      },
    })),
    ...entityResult.locations.map((l) => ({
      model: 'location' as EntityModel,
      name: l.name,
      row: {
        name: l.name,
        aliases: Array.isArray(l.aliases) ? l.aliases : [],
        description: l.description || null,
        confidence: l.confidence ?? 0.5,
        chapterRef: l.chapterRef ?? null,
        firstChapter: l.firstChapter ?? null,
        lastChapter: l.lastChapter ?? null,
        chapterAppearances: l.chapterAppearances ?? [],
        mentionCount: l.mentionCount ?? 0,
      },
    })),
    ...entityResult.items.map((i) => ({
      model: 'item' as EntityModel,
      name: i.name,
      row: {
        name: i.name,
        aliases: Array.isArray(i.aliases) ? i.aliases : [],
        description: i.description || null,
        confidence: i.confidence ?? 0.5,
        chapterRef: i.chapterRef ?? null,
        firstChapter: i.firstChapter ?? null,
        lastChapter: i.lastChapter ?? null,
        chapterAppearances: i.chapterAppearances ?? [],
        mentionCount: i.mentionCount ?? 0,
        category: inferItemCategory(i.name, i.description || ''),
      },
    })),
    ...entityResult.worldviews.map((w) => ({
      model: 'worldviewSetting' as EntityModel,
      name: w.name,
      row: {
        name: w.name,
        aliases: Array.isArray(w.aliases) ? w.aliases : [],
        description: w.description || null,
        confidence: w.confidence ?? 0.5,
        chapterRef: w.chapterRef ?? null,
        mentionCount: w.mentionCount ?? 0,
      },
    })),
  ];

  const { created, merged } = await mergeEntitiesIntoDb(bookId, incoming);

  // 全部章节补跑成功 → 清警告；仍有失败 → 更新失败清单为剩余章节
  if (stillFailed.size === 0) {
    await clearFailedBatches(bookId);
  } else {
    const tasksNow = await TaskRepository.findByBookId(bookId);
    const extractorTask = tasksNow.find((t) => t.agentType === 'extractor' && t.status === 'completed');
    if (extractorTask) {
      const result = (extractorTask.result as Record<string, unknown> | undefined) ?? {};
      const remaining = [...stillFailed].sort((a, b) => a - b);
      result.failedBatches = [
        {
          batch: 0,
          error: `补跑后仍有 ${remaining.length} 章失败`,
          chapterFrom: remaining[0],
          chapterTo: remaining[remaining.length - 1],
        },
      ];
      await prisma.task.update({ where: { id: extractorTask.id }, data: { result: result as object } });
    }
  }

  const retried = targetChapters.map((ch) => ch.index);
  const message = stillFailed.size === 0
    ? `已补跑 ${retried.length} 章：新增实体 ${created} 个、合并 ${merged} 个`
    : `补跑完成，但仍有 ${stillFailed.size} 章失败，可稍后再次补跑`;

  return {
    retriedChapters: retried,
    newEntities: created,
    mergedEntities: merged,
    stillFailedChapters: [...stillFailed].sort((a, b) => a - b),
    message,
  };
}
