/**
 * 低置信度实体人工通过后的独立补写服务（实施包 A3）。
 *
 * 流程：
 *   人工通过（reviewSource=USER，状态 APPROVED，写 EntityReview）
 *   → 接口返回 enrichmentAvailable=true
 *   → 用户确认后入队 BackgroundJob（kind=entity-enrichment）
 *   → 后台读取原文中实体相关片段，调用模型生成描述
 *   → 写回实体描述（用户已锁定的字段不覆盖），并写 AI_REFRESH 审核记录
 *
 * 补写失败只标记任务失败，不回滚人工通过；补写结果通过实体与产物清单可见。
 */
import { z } from 'zod';
import {
  BackgroundJobRepository,
  BookRepository,
  CharacterRepository,
  LocationRepository,
  ItemRepository,
  WorldviewRepository,
  EntityReviewRepository,
  getSharedAssetSourceResolver,
  prisma,
} from '@qunxiang/storage';
import { getDefaultProvider } from '@qunxiang/llm';

export type EnrichableEntityType = 'character' | 'location' | 'item' | 'worldview';

export interface EntityEnrichmentJobPayload {
  bookId: string;
  ownerId: string;
  entityType: EnrichableEntityType;
  entityId: string;
  actorId: string;
}

/** 描述缺失或过短即视为可补写。 */
export function isEnrichmentAvailable(entity: { description?: string | null; status: string }): boolean {
  if (entity.status !== 'APPROVED') return false;
  return !entity.description || entity.description.trim().length < 30;
}

/** 入队独立补写任务（幂等键：实体 + 日切，重复确认只排一个）。 */
export async function requestEntityEnrichment(payload: EntityEnrichmentJobPayload): Promise<string> {
  const uniqueKey = `entity-enrichment:${payload.entityType}:${payload.entityId}`;
  const job = await BackgroundJobRepository.enqueue({
    kind: 'entity-enrichment',
    uniqueKey,
    payload,
    // 之前失败/完成后再次确认补写时，把同键任务重置为 pending 重投
    reactivate: true,
    now: new Date(),
  });
  return job.id;
}

// 各实体模型的 Prisma 委托（union 直调会因签名不兼容报错，调用处用 switch 分派）
type EntityModelDelegate =
  | typeof prisma.character
  | typeof prisma.location
  | typeof prisma.item
  | typeof prisma.worldviewSetting;

function getModelDelegate(entityType: EnrichableEntityType): EntityModelDelegate {
  switch (entityType) {
    case 'character': return prisma.character;
    case 'location': return prisma.location;
    case 'item': return prisma.item;
    case 'worldview': return prisma.worldviewSetting;
  }
}

interface EntityRow {
  id: string;
  bookId: string;
  name: string;
  description: string | null;
  status: string;
  confidence: number;
  lockedFields: unknown;
  version: number;
  chapterAppearances: unknown;
  aliases: unknown;
}

async function loadEntity(entityType: EnrichableEntityType, entityId: string): Promise<EntityRow | null> {
  return (getModelDelegate(entityType) as unknown as { findUnique(args: { where: { id: string } }): Promise<EntityRow | null> }).findUnique({ where: { id: entityId } });
}

/** 从全文中抽取实体相关片段：按名字/别名出现位置切窗，总长上限 ~6000 字。 */
export function collectEvidenceSnippets(
  content: string,
  names: string[],
  maxChars = 6000,
): string {
  const validNames = names.filter((n) => n && n.length >= 2);
  if (validNames.length === 0) return '';
  const windows: Array<{ start: number; end: number }> = [];
  for (const name of validNames) {
    let idx = content.indexOf(name);
    let hits = 0;
    while (idx !== -1 && hits < 5) {
      windows.push({ start: Math.max(0, idx - 400), end: Math.min(content.length, idx + 800) });
      idx = content.indexOf(name, idx + name.length);
      hits += 1;
    }
  }
  if (windows.length === 0) return '';
  windows.sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const w of windows) {
    const last = merged[merged.length - 1];
    if (last && w.start <= last.end) last.end = Math.max(last.end, w.end);
    else merged.push({ ...w });
  }
  const parts: string[] = [];
  let used = 0;
  for (const w of merged) {
    if (used >= maxChars) break;
    const slice = content.slice(w.start, Math.min(w.end, w.start + (maxChars - used)));
    parts.push(slice);
    used += slice.length;
  }
  return parts.join('\n……\n');
}

const enrichmentSchema = z.object({ description: z.string().min(1) });

/** 执行补写：生成中文描述并写回（锁定字段不覆盖），失败抛错由任务层记录。 */
export async function processEntityEnrichmentJob(payload: EntityEnrichmentJobPayload): Promise<{ description: string }> {
  const entity = await loadEntity(payload.entityType, payload.entityId);
  if (!entity || entity.bookId !== payload.bookId) {
    throw new Error('实体不存在或不属于该书籍');
  }
  // 补写失败不回滚人工通过；这里仅拦截未通过实体，避免无效模型调用。
  if (entity.status !== 'APPROVED') {
    throw new Error('仅人工通过的实体可以补写');
  }

  const locked = Array.isArray(entity.lockedFields) ? (entity.lockedFields as string[]) : [];
  if (locked.includes('description')) {
    return { description: entity.description ?? '' };
  }

  const book = await BookRepository.findById(payload.bookId);
  if (!book) throw new Error('书籍不存在');

  const content = await getSharedAssetSourceResolver().readSourceText(book);
  const aliasList = Array.isArray(entity.aliases) ? (entity.aliases as string[]) : [];
  const snippets = collectEvidenceSnippets(content, [entity.name, ...aliasList]);
  if (!snippets) {
    throw new Error('原文中未找到该实体相关内容，无法补写');
  }

  const provider = await getDefaultProvider();
  const result = await provider.chatExtract(
    '你是一位中文小说资料整理助手。请只依据给定原文片段，为指定实体写一段客观、信息密集的中文介绍（80-200 字）。不得虚构原文没有的信息。输出 JSON：{"description": "…"}',
    `实体类型：${payload.entityType}\n实体名称：${entity.name}\n\n原文片段：\n${snippets}`,
    enrichmentSchema,
  );
  const description = result.description.trim();
  if (!description) throw new Error('模型未返回有效描述');

  const delegate = getModelDelegate(payload.entityType) as unknown as { update(args: unknown): Promise<unknown> };
  await delegate.update({
    where: { id: entity.id },
    data: {
      description: entity.description ? `${entity.description}\n${description}` : description,
      version: { increment: 1 },
    },
  });
  await EntityReviewRepository.create({
    bookId: entity.bookId,
    entityType: payload.entityType,
    entityId: entity.id,
    entityName: entity.name,
    actorId: payload.actorId,
    actorType: 'SYSTEM',
    action: 'AI_REFRESH',
    changedFields: ['description'],
    reason: '低置信度实体人工通过后的独立补写',
  });
  return { description };
}

/** 供仓储层按类型取实体（路由校验归属用）。 */
export function findOwnedEntityForEnrichment(
  entityType: EnrichableEntityType,
  entityId: string,
  ownerId: string,
) {
  switch (entityType) {
    case 'character':
      return CharacterRepository.findOwnedById(entityId, ownerId);
    case 'location':
      return LocationRepository.findOwnedById(entityId, ownerId);
    case 'item':
      return ItemRepository.findOwnedById(entityId, ownerId);
    case 'worldview':
      return WorldviewRepository.findOwnedById(entityId, ownerId);
  }
}
