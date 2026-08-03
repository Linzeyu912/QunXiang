/**
 * 公共素材库业务服务（阶段一 MVP）。
 *
 * 发布 = 拍快照：把实体的当前内容完整复制进 payload（JSON），
 * 图片只建引用不复制字节（AssetObject 内容寻址天然去重）。
 * 之后发布者改书、删书、重新提取，都不影响公共池里的副本。
 *
 * 拿取落点 = 拿取者指定一本自己的书，实体以 PENDING 状态进入该书的待审核列表。
 *
 * 审核策略 = 后置：发布即公开。兜底手段 = 发布者下架。
 */
import {
  AuditLogRepository,
  AssetObjectRepository,
  CharacterRepository,
  ItemRepository,
  LocationRepository,
  EntityImageRepository,
  PublicAssetRepository,
  PublicAssetImageRepository,
  PublicAssetTakeRepository,
  UserRepository,
  getSharedObjectStore,
  prisma,
  type CreatePublicAssetImageInput,
  type EntityImageRow,
  type PublicAssetListItem,
} from '@novel-agent/storage';
import { readArtifactJson } from './artifact-store.js';
import type { VisualDescriptionEntry, GenerationPromptEntry } from './artifacts.service.js';

/** 实体类型。与前端保持一致。 */
export type EntityType = 'character' | 'location' | 'item';

const VALID_KINDS = new Set<EntityType>(['character', 'location', 'item']);

const ASSET_NOT_FOUND_MSG = '素材不存在或已下架';
const ASSET_ACCESS_DENIED_MSG = '素材不存在或已下架';

export class PublicAssetError extends Error {
  constructor(message: string, public statusCode: number = 400) {
    super(message);
    this.name = 'PublicAssetError';
  }
}

// ── 前端友好的响应类型 ──

export interface PublicAssetImageResponse {
  id: string;
  objectKey: string;
  mime: string;
  bytes: number;
  aspectRatio: string | null;
  stage: string | null;
  isPrimary: boolean;
  url: string;
}

export interface PublicAssetDetailResponse {
  id: string;
  publisherId: string;
  publisherName: string;
  kind: string;
  name: string;
  summary: string | null;
  tags: string[];
  payload: Record<string, unknown>;
  takenCount: number;
  createdAt: string;
  images: PublicAssetImageResponse[];
}

export interface PublicAssetSummaryItem {
  id: string;
  publisherId: string;
  publisherName: string;
  kind: string;
  name: string;
  summary: string | null;
  tags: string[];
  takenCount: number;
  createdAt: string;
  primaryImageUrl: string | null;
  status?: string; // 我的发布列表用
}

export interface ListPublicAssetsResult {
  items: PublicAssetSummaryItem[];
  nextCursor: { createdAt: string; id: string } | null;
}

// ── 辅助函数 ──

function validateKind(kind: string): asserts kind is EntityType {
  if (!VALID_KINDS.has(kind as EntityType)) {
    throw new PublicAssetError('实体类型必须为角色、场景或道具', 400);
  }
}

/** 签名图片 URL（10 分钟有效）。 */
async function signImageUrl(objectKey: string): Promise<string> {
  const signed = await getSharedObjectStore().createDownloadUrl({
    objectKey,
    expiresInSeconds: 600,
  });
  return signed.url;
}

/** summary 默认取 description 前 80 字。 */
function defaultSummary(description?: string | null): string | null {
  if (!description) return null;
  return description.length > 80 ? description.slice(0, 80) + '…' : description;
}

// ── 发布 ──

export interface PublishAssetInput {
  bookId: string;
  entityType: string;
  entityId: string;
  summary?: string;
  tags?: string[];
  showSource?: boolean;
}

/**
 * 发布实体卡到公共池。
 *
 * 1. 校验书籍归属 + 实体存在且 APPROVED
 * 2. 读 artifacts JSON 构建快照 payload（visualDetails + promptVariants）
 * 3. 收集该实体的 EntityImage，对每张图 putIfAbsent 创建/复用 AssetObject 行
 * 4. 事务：建 PublicAsset + 批量建 PublicAssetImage
 */
export async function publishAsset(
  ownerId: string,
  input: PublishAssetInput,
): Promise<{ id: string }> {
  validateKind(input.entityType);

  // 查实体，校验 APPROVED
  const entity = await loadOwnedEntity(input.bookId, ownerId, input.entityType, input.entityId);
  if (!entity) {
    throw new PublicAssetError('实体不存在或无权访问', 404);
  }
  if (entity.status !== 'APPROVED') {
    throw new PublicAssetError('只有已审核通过的实体才能发布到公共库', 400);
  }

  // 查书名（署名用）
  const book = await prisma.book.findUnique({
    where: { id: input.bookId },
    select: { title: true },
  });
  if (!book) {
    throw new PublicAssetError('书籍不存在或无权访问', 404);
  }

  // 读 artifacts JSON 构建快照 payload
  const prefix = input.entityType;
  const visualEntry = await readEntityArtifact<VisualDescriptionEntry>(
    input.bookId,
    `${prefix}-visual-descriptions.json`,
    entity.name,
  );
  const promptEntry = await readEntityArtifact<GenerationPromptEntry>(
    input.bookId,
    `${prefix}-prompts.json`,
    entity.name,
  );

  const payload: Record<string, unknown> = {
    name: entity.name,
    aliases: normalizeAliases(entity.aliases),
    description: entity.description ?? null,
    visualDetails: visualEntry?.visualDetails ?? null,
    enhancedDescription: visualEntry?.enhancedDescription ?? null,
    promptVariants: promptEntry?.variants ?? [],
  };
  if (input.showSource !== false) {
    payload.sourceBookTitle = book.title;
  }

  // 收集该实体图片
  const images = await EntityImageRepository.findManyByOwnedEntity(
    input.bookId,
    ownerId,
    input.entityType,
    entity.name,
  );

  // 对每张有 objectKey 的图，确保 AssetObject 行存在（补全引用计数）
  const imageInputs: CreatePublicAssetImageInput[] = [];
  for (const img of images) {
    if (!img.objectKey) continue;
    const assetObject = await ensureAssetObject(img);
    imageInputs.push({
      publicAssetId: '', // 事务后回填
      assetObjectId: assetObject.id,
      objectKey: img.objectKey,
      mime: img.mime,
      bytes: img.bytes,
      aspectRatio: img.aspectRatio,
      stage: img.stage,
      isPrimary: img.isPrimary,
      sortOrder: img.sortOrder,
    });
  }

  const summary = input.summary?.trim() || defaultSummary(entity.description);
  const tags = input.tags ?? [];

  // 事务：建 PublicAsset + 批量建 PublicAssetImage
  const asset = await prisma.$transaction(async (tx) => {
    const created = await tx.publicAsset.create({
      data: {
        publisherId: ownerId,
        kind: input.entityType,
        name: entity.name,
        summary,
        tags,
        payload: payload as never,
        status: 'published',
      },
    });
    if (imageInputs.length > 0) {
      await tx.publicAssetImage.createMany({
        data: imageInputs.map((img) => ({
          publicAssetId: created.id,
          assetObjectId: img.assetObjectId,
          objectKey: img.objectKey,
          mime: img.mime,
          bytes: img.bytes,
          aspectRatio: img.aspectRatio ?? null,
          stage: img.stage ?? null,
          isPrimary: img.isPrimary,
          sortOrder: img.sortOrder,
        })),
      });
    }
    return created;
  });

  await AuditLogRepository.create({
    actorType: 'USER',
    actorId: ownerId,
    action: 'PUBLIC_ASSET_PUBLISHED',
    targetType: 'PUBLIC_ASSET',
    targetId: asset.id,
    metadata: { kind: input.entityType, name: entity.name, bookId: input.bookId },
  });

  return { id: asset.id };
}

/** 读 artifacts JSON 并按实体名查找条目。 */
async function readEntityArtifact<T>(
  bookId: string,
  logicalPath: string,
  entityName: string,
): Promise<T | null> {
  const entries = await readArtifactJson<T[]>(bookId, `entities/${logicalPath}`);
  if (!Array.isArray(entries)) return null;
  return (
    (entries as Array<Record<string, unknown>>).find(
      (e) => e.name === entityName || e.entityName === entityName,
    ) as T | undefined
  ) ?? null;
}

interface OwnedEntity {
  id: string;
  name: string;
  aliases: unknown;
  description?: string | null;
  status: string;
}

async function loadOwnedEntity(
  bookId: string,
  ownerId: string,
  type: EntityType,
  entityId: string,
): Promise<OwnedEntity | null> {
  if (type === 'character') {
    const c = await CharacterRepository.findOwnedById(entityId, ownerId);
    if (!c || c.bookId !== bookId) return null;
    return { id: c.id, name: c.name, aliases: c.aliases, description: c.description, status: c.status };
  }
  if (type === 'location') {
    const l = await LocationRepository.findOwnedById(entityId, ownerId);
    if (!l || l.bookId !== bookId) return null;
    return { id: l.id, name: l.name, aliases: l.aliases, description: l.description, status: l.status };
  }
  const i = await ItemRepository.findOwnedById(entityId, ownerId);
  if (!i || i.bookId !== bookId) return null;
  return { id: i.id, name: i.name, aliases: i.aliases, description: i.description, status: i.status };
}

function normalizeAliases(aliases: unknown): string[] {
  return Array.isArray(aliases) ? (aliases as string[]) : [];
}

/** 确保 EntityImage 对应的 AssetObject 行存在（引用计数安全）。 */
async function ensureAssetObject(img: EntityImageRow): Promise<{ id: string }> {
  if (!img.objectKey) throw new Error('图片缺少对象键');
  // 通过 objectKey 查找已有 AssetObject
  let assetObj = await AssetObjectRepository.findByObjectKey(img.objectKey);
  if (assetObj) return { id: assetObj.id };
  // 不存在则用 head 读元数据后创建
  const meta = await getSharedObjectStore().head(img.objectKey);
  if (!meta) throw new Error(`图片对象不存在：${img.objectKey}`);
  assetObj = await AssetObjectRepository.putIfAbsent({
    sha256: meta.sha256 ?? img.objectKey,
    bytes: meta.bytes,
    mime: img.mime,
    objectKey: img.objectKey,
    etag: meta.etag,
  });
  return { id: assetObj.id };
}

// ── 浏览公共池 ──

export interface ListPublicAssetsQuery {
  kind?: string;
  tags?: string[];
  q?: string;
  sort?: 'new' | 'hot';
  cursor?: { createdAt: string; id: string } | null;
}

export async function listPublicAssets(
  query: ListPublicAssetsQuery,
): Promise<ListPublicAssetsResult> {
  const result = await PublicAssetRepository.findPublished({
    kind: query.kind,
    tags: query.tags,
    q: query.q,
    sort: query.sort ?? 'new',
    cursor: query.cursor
      ? { createdAt: new Date(query.cursor.createdAt), id: query.cursor.id }
      : null,
  });

  const items = await attachPublisherAndImage(result.items);

  return {
    items,
    nextCursor: result.nextCursor
      ? {
          createdAt: result.nextCursor.createdAt.toISOString(),
          id: result.nextCursor.id,
        }
      : null,
  };
}

/** 热门标签聚合（从已发布素材统计）。 */
export async function listPopularTags(limit = 30): Promise<{ tag: string; count: number }[]> {
  return PublicAssetRepository.aggregateTags(limit);
}

/** 我的发布列表（含已下架）。 */
export async function listMyPublicAssets(publisherId: string): Promise<PublicAssetSummaryItem[]> {
  const rows = await PublicAssetRepository.findByPublisher(publisherId);
  return attachPublisherAndImage(rows);
}

/** 给列表项附加发布者昵称和主图 URL。 */
async function attachPublisherAndImage(
  rows: PublicAssetListItem[],
): Promise<PublicAssetSummaryItem[]> {
  if (rows.length === 0) return [];

  const publisherIds = [...new Set(rows.map((r) => r.publisherId))];
  const publishers = await Promise.all(
    publisherIds.map((id) => UserRepository.findById(id)),
  );
  const publisherMap = new Map(publishers.filter(Boolean).map((u) => [u!.id, u!.name]));

  const assetIds = rows.map((r) => r.id);
  const primaryImageMap = await PublicAssetImageRepository.findPrimaryByAssetIds(assetIds);

  // 批量签名主图 URL
  const urlEntries = await Promise.all(
    [...primaryImageMap.entries()].map(async ([assetId, img]) => {
      try {
        const url = await signImageUrl(img.objectKey);
        return [assetId, url] as const;
      } catch {
        return [assetId, null] as const;
      }
    }),
  );
  const urlMap = new Map(urlEntries);

  return rows.map((r) => ({
    id: r.id,
    publisherId: r.publisherId,
    publisherName: publisherMap.get(r.publisherId) ?? '',
    kind: r.kind,
    name: r.name,
    summary: r.summary,
    tags: r.tags,
    takenCount: r.takenCount,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    primaryImageUrl: urlMap.get(r.id) ?? null,
    status: r.status,
  }));
}

// ── 详情 ──

export async function getPublicAssetDetail(id: string): Promise<PublicAssetDetailResponse> {
  const asset = await PublicAssetRepository.findPublishedById(id);
  if (!asset) {
    throw new PublicAssetError(ASSET_NOT_FOUND_MSG, 404);
  }

  const images = await PublicAssetImageRepository.findByPublicAssetId(asset.id);
  const imageResponses = await Promise.all(
    images.map(async (img) => ({
      id: img.id,
      objectKey: img.objectKey,
      mime: img.mime,
      bytes: img.bytes,
      aspectRatio: img.aspectRatio,
      stage: img.stage,
      isPrimary: img.isPrimary,
      url: await signImageUrl(img.objectKey),
    })),
  );

  const publisher = await UserRepository.findById(asset.publisherId);

  return {
    id: asset.id,
    publisherId: asset.publisherId,
    publisherName: publisher?.name ?? '',
    kind: asset.kind,
    name: asset.name,
    summary: asset.summary,
    tags: Array.isArray(asset.tags) ? (asset.tags as string[]) : [],
    payload: asset.payload as Record<string, unknown>,
    takenCount: asset.takenCount,
    createdAt: asset.createdAt.toISOString(),
    images: imageResponses,
  };
}

// ── 拿取 ──

export interface TakeAssetInput {
  targetBookId: string;
}

export interface TakeAssetResult {
  entityId: string;
  entityName: string;
  alreadyTaken: boolean;
}

/**
 * 拿取公共素材到指定书。
 *
 * 1. 校验目标书归属
 * 2. 查 PublicAsset（仅 published）+ images
 * 3. 查重：同一素材拿取到同一本书 → 返回 alreadyTaken 提示
 * 4. 名称冲突检查：目标书同类型+同名 → 加后缀
 * 5. 事务：建实体(PENDING) + 建 EntityImage + 建 PublicAssetTake + takenCount+1
 */
export async function takeAsset(
  publicAssetId: string,
  takerId: string,
  input: TakeAssetInput,
): Promise<TakeAssetResult> {
  const asset = await PublicAssetRepository.findPublishedById(publicAssetId);
  if (!asset) {
    throw new PublicAssetError(ASSET_ACCESS_DENIED_MSG, 404);
  }

  // 校验目标书归属
  const targetBook = await prisma.book.findFirst({
    where: { id: input.targetBookId, userId: takerId },
    select: { id: true },
  });
  if (!targetBook) {
    throw new PublicAssetError('目标书籍不存在或无权访问', 404);
  }

  // 查重
  const alreadyTaken = await PublicAssetTakeRepository.findExisting(
    publicAssetId,
    takerId,
    input.targetBookId,
  );

  const payload = asset.payload as {
    name?: string;
    aliases?: string[];
    description?: string;
  };
  const entityName = payload.name ?? asset.name;
  const aliases = Array.isArray(payload.aliases) ? payload.aliases : [];
  const description = payload.description ?? null;

  const kind = asset.kind as EntityType;
  validateKind(kind);

  // 名称冲突检查
  const finalName = await resolveNameConflict(
    input.targetBookId,
    kind,
    entityName,
  );

  const images = await PublicAssetImageRepository.findByPublicAssetId(publicAssetId);

  // 事务：建实体 + 图片 + 拿取记录 + 计数
  const entityId = await prisma.$transaction(async (tx) => {
    // 建实体（status=PENDING）
    let newEntityId: string;
    if (kind === 'character') {
      const created = await tx.character.create({
        data: {
          bookId: input.targetBookId,
          name: finalName,
          aliases: aliases,
          description,
          confidence: 0.5,
          status: 'PENDING',
        },
      });
      newEntityId = created.id;
    } else if (kind === 'location') {
      const created = await tx.location.create({
        data: {
          bookId: input.targetBookId,
          name: finalName,
          aliases: aliases,
          description,
          confidence: 0.5,
          status: 'PENDING',
        },
      });
      newEntityId = created.id;
    } else {
      const created = await tx.item.create({
        data: {
          bookId: input.targetBookId,
          name: finalName,
          aliases: aliases,
          description,
          confidence: 0.5,
          status: 'PENDING',
        },
      });
      newEntityId = created.id;
    }

    // 建 EntityImage（引用同一 objectKey，不复制字节）
    for (const img of images) {
      await tx.entityImage.create({
        data: {
          bookId: input.targetBookId,
          entityType: kind,
          entityName: finalName,
          filePath: '',
          objectKey: img.objectKey,
          mime: img.mime,
          ext: extFromMime(img.mime),
          bytes: img.bytes,
          aspectRatio: img.aspectRatio,
          source: 'generated',
          stage: img.stage,
          isPrimary: img.isPrimary,
          sortOrder: img.sortOrder,
        },
      });
    }

    // 建拿取记录
    if (!alreadyTaken) {
      await tx.publicAssetTake.create({
        data: {
          publicAssetId,
          takerId,
          targetBookId: input.targetBookId,
        },
      });
      await tx.publicAsset.update({
        where: { id: publicAssetId },
        data: { takenCount: { increment: 1 } },
      });
    }

    return newEntityId;
  });

  await AuditLogRepository.create({
    actorType: 'USER',
    actorId: takerId,
    action: 'PUBLIC_ASSET_TAKEN',
    targetType: 'PUBLIC_ASSET',
    targetId: publicAssetId,
    metadata: {
      targetBookId: input.targetBookId,
      entityId,
      entityName: finalName,
      alreadyTaken,
    },
  });

  return { entityId, entityName: finalName, alreadyTaken };
}

/** 名称冲突检查：目标书已有同名同类型实体则加后缀。 */
async function resolveNameConflict(
  bookId: string,
  kind: EntityType,
  name: string,
): Promise<string> {
  let existing: { id: string } | null = null;
  if (kind === 'character') {
    existing = await prisma.character.findFirst({ where: { bookId, name }, select: { id: true } });
  } else if (kind === 'location') {
    existing = await prisma.location.findFirst({ where: { bookId, name }, select: { id: true } });
  } else {
    existing = await prisma.item.findFirst({ where: { bookId, name }, select: { id: true } });
  }
  if (!existing) return name;
  return `（公共库·${name}）`;
}

function extFromMime(mime: string): string {
  if (mime.includes('png')) return 'png';
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  if (mime.includes('webp')) return 'webp';
  return 'png';
}

// ── 下架 ──

export async function unlistAsset(
  assetId: string,
  publisherId: string,
): Promise<boolean> {
  const ok = await PublicAssetRepository.unlist(assetId, publisherId);
  if (ok) {
    await AuditLogRepository.create({
      actorType: 'USER',
      actorId: publisherId,
      action: 'PUBLIC_ASSET_UNLISTED',
      targetType: 'PUBLIC_ASSET',
      targetId: assetId,
      metadata: {},
    });
  }
  return ok;
}
