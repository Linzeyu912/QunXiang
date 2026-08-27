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
} from '@qunxiang/storage';
import { z } from 'zod';
import {
  getDefaultProvider,
  LLMError,
  ProviderNotConfiguredError,
} from '@qunxiang/llm';
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
  /** 版权声明（实施包 H2） */
  licenseType?: 'original' | 'authorized' | 'public_domain' | null;
  attributionRequired?: boolean;
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
  /** 版权声明（实施包 H2）：original=本人原创 | authorized=已获授权 | public_domain=公版内容 */
  licenseType?: 'original' | 'authorized' | 'public_domain';
  /** 复用许可与署名要求的补充说明 */
  licenseNote?: string;
  /** 是否要求署名 */
  attributionRequired?: boolean;
  /** 权利确认勾选（必须为 true 才能发布） */
  rightsConfirmed?: boolean;
}

const VALID_LICENSE_TYPES = new Set(['original', 'authorized', 'public_domain']);

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

  // 版权声明为发布必填（实施包 H2）
  if (!input.rightsConfirmed) {
    throw new PublicAssetError('请先勾选权利确认：发布内容不侵犯他人著作权', 400);
  }
  if (!input.licenseType || !VALID_LICENSE_TYPES.has(input.licenseType)) {
    throw new PublicAssetError('请选择版权声明：本人原创 / 已获授权 / 公版内容', 400);
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
        licenseType: input.licenseType,
        licenseNote: input.licenseNote?.slice(0, 500) ?? null,
        attributionRequired: input.attributionRequired ?? false,
        rightsConfirmedAt: new Date(),
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

// ── 发布标签智能识别 ──

/** 题材白名单（与前端 web/src/constants/genre-tags.ts 保持同步）。 */
const GENRE_WHITELIST = new Set([
  '都市', '玄幻', '仙侠', '武侠', '科幻', '奇幻',
  '历史', '军事', '游戏', '体育', '悬疑', '灵异',
  '现实', '言情', '轻小说',
]);

/**
 * 题材关键词映射（模型不可用时的规则兜底）。
 * 文本命中任意关键词即认为该题材候选，最多取 2 个。
 */
const GENRE_KEYWORDS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['仙侠', ['修仙', '修真', '仙人', '灵根', '筑基', '金丹', '元婴', '化神', '渡劫', '飞升', '灵石', '灵气', '法诀', '剑修', '仙门', '道法']],
  ['玄幻', ['斗气', '魔核', '武魂', '异火', '魔兽', '斗者', '斗师', '玄功', '功法']],
  ['武侠', ['武林', '江湖', '内力', '武功', '剑法', '刀法', '掌门', '门派', '镖局', '大侠', '山庄', '硬功', '宗师']],
  ['都市', ['都市', '总裁', '白领', '写字楼', '公寓']],
  ['科幻', ['星际', '飞船', '机甲', '虫族', '基因', '人工智能', '机器人', '外星', '殖民星']],
  ['历史', ['朝廷', '皇帝', '皇子', '公主', '宰相', '王朝', '江山', '登基', '科举', '县令']],
  ['军事', ['军队', '士兵', '特种兵', '军团', '军衔', '教官', '战场']],
  ['游戏', ['玩家', '副本', '经验值', '属性面板', '游戏系统']],
  ['悬疑', ['侦探', '案件', '凶手', '线索', '推理', '破案', '失踪案']],
  ['灵异', ['僵尸', '阴间', '驱邪', '灵异', '妖怪', '阴魂', '鬼宅']],
  ['奇幻', ['精灵', '法师', '魔法师', '矮人', '龙骑士', '魔王', '圣剑']],
  ['言情', ['恋爱', '婚约', '恋人', '情愫']],
  ['体育', ['足球', '篮球', '锦标赛', '冠军', '运动员', '教练']],
  ['现实', ['高考', '乡村教师', '进城务工', '下岗']],
];

/** 标签识别的返回结构（严格校验，缺字段即失败走规则兜底）。 */
const suggestTagsSchema = z.object({
  genres: z.array(z.string()),
  tags: z.array(z.string()),
});

const SUGGEST_TAGS_SYSTEM_PROMPT = [
  '你是小说实体素材的标签助手。根据提供的实体信息完成两项任务：',
  '1. 从题材列表中选出最匹配的题材（最多 2 个，都不匹配则返回空数组）：',
  '都市、玄幻、仙侠、武侠、科幻、奇幻、历史、军事、游戏、体育、悬疑、灵异、现实、言情、轻小说',
  '2. 生成 2-4 个简短的内容标签，概括该实体的身份、流派或风格（每个 2-6 字，不得与题材名重复）。',
  '只返回 JSON，格式：{"genres": ["..."], "tags": ["..."]}',
].join('\n');

const KIND_LABELS: Record<EntityType, string> = {
  character: '角色',
  location: '场景',
  item: '道具',
};

export interface SuggestPublishTagsInput {
  bookId: string;
  entityType: string;
  entityId: string;
}

export interface SuggestPublishTagsResult {
  /** 题材标签（白名单内，最多 2 个） */
  genres: string[];
  /** 自定义内容标签（最多 6 个） */
  tags: string[];
  /** 识别来源：llm = 模型识别；rule = 关键词兜底；none = 未识别到 */
  source: 'llm' | 'rule' | 'none';
  /** 降级/未识别原因（有值时前端展示提示） */
  message?: string;
}

/** 清洗模型返回的标签：题材过滤进白名单，内容标签去题材词、去重并限长限量。 */
function sanitizeSuggestedTags(rawGenres: string[], rawTags: string[]): {
  genres: string[];
  tags: string[];
} {
  const genres = [...new Set(rawGenres.map((g) => g.trim()))]
    .filter((g) => GENRE_WHITELIST.has(g))
    .slice(0, 2);
  const tags = [...new Set(rawTags.map((t) => t.trim()))]
    .filter((t) => t.length > 0 && t.length <= 10 && !GENRE_WHITELIST.has(t))
    .slice(0, 6);
  return { genres, tags };
}

/** 关键词规则识别题材：按映射顺序命中即候选，最多取 2 个。 */
function matchGenresByKeyword(text: string): string[] {
  const matched: string[] = [];
  for (const [genre, keywords] of GENRE_KEYWORDS) {
    if (keywords.some((kw) => text.includes(kw))) {
      matched.push(genre);
      if (matched.length >= 2) break;
    }
  }
  return matched;
}

/** 模型调用错误 → 用户友好的中文原因（识别是辅助功能，失败只降级提示，不阻断发布）。 */
function friendlyLlmErrorMessage(err: unknown): string {
  if (err instanceof ProviderNotConfiguredError) {
    return '模型服务未配置';
  }
  if (err instanceof LLMError) {
    switch (err.code) {
      case 'AUTH_ERROR': return '模型服务认证失败（API Key 无效或权限不足）';
      case 'RATE_LIMIT': return '模型服务请求过于频繁';
      case 'TIMEOUT': return '模型服务响应超时';
      case 'MODEL_NOT_FOUND': return '模型名称不存在';
      case 'NETWORK_ERROR': return '模型服务网络连接失败';
      case 'VALIDATION_ERROR': return '模型返回格式异常';
      default: return '模型服务调用失败';
    }
  }
  if (err instanceof Error && err.name === 'ZodError') {
    return '模型返回格式异常';
  }
  return '模型服务不可用';
}

/**
 * 发布前的初步标签识别。
 *
 * 优先用模型根据实体名称/别名/简介/书名识别题材与内容标签；
 * 模型未配置或调用失败时按关键词规则兜底识别题材。
 * 识别结果仅供发布对话框预填，用户可人工修改后再发布。
 */
export async function suggestPublishTags(
  ownerId: string,
  input: SuggestPublishTagsInput,
): Promise<SuggestPublishTagsResult> {
  validateKind(input.entityType);
  const entity = await loadOwnedEntity(input.bookId, ownerId, input.entityType, input.entityId);
  if (!entity) {
    throw new PublicAssetError('实体不存在或无权访问', 404);
  }

  const book = await prisma.book.findUnique({
    where: { id: input.bookId },
    select: { title: true },
  });
  if (!book) {
    throw new PublicAssetError('书籍不存在或无权访问', 404);
  }

  const aliases = normalizeAliases(entity.aliases);
  const description = entity.description ?? '';
  // 规则兜底的匹配文本（题材关键词主要出现在简介与书名中）
  const ruleText = `${entity.name} ${aliases.join(' ')} ${description} ${book.title}`;

  // 1) 模型识别（已配置才调用；失败不阻断，降级到关键词规则）
  let llmUnavailableReason: string | undefined;
  try {
    const provider = await getDefaultProvider();
    if (await provider.isConfigured()) {
      const userPrompt = [
        `实体类型：${KIND_LABELS[input.entityType]}`,
        `实体名称：${entity.name}`,
        `别名：${aliases.length > 0 ? aliases.join('、') : '无'}`,
        `简介：${description || '无'}`,
        `来源书名：${book.title}`,
      ].join('\n');
      const raw = await provider.chatExtract(
        SUGGEST_TAGS_SYSTEM_PROMPT,
        userPrompt,
        suggestTagsSchema,
      );
      // 部分 provider（如 mock）不按契约校验 schema，这里再验一次结构
      const parsed = suggestTagsSchema.safeParse(raw);
      if (!parsed.success) {
        llmUnavailableReason = '模型返回格式异常';
      } else {
        const { genres, tags } = sanitizeSuggestedTags(parsed.data.genres, parsed.data.tags);
        if (genres.length > 0 || tags.length > 0) {
          return { genres, tags, source: 'llm' };
        }
        // 模型判定没有合适标签：继续走关键词兜底，尽量给出初步题材
      }
    } else {
      llmUnavailableReason = '模型服务未配置';
    }
  } catch (err) {
    llmUnavailableReason = friendlyLlmErrorMessage(err);
    console.warn(`[公共素材] 标签智能识别失败，已降级关键词规则：${llmUnavailableReason}`);
  }

  // 2) 关键词规则兜底（只识别题材，不生成内容标签）
  const ruleGenres = matchGenresByKeyword(ruleText);
  if (ruleGenres.length > 0) {
    return {
      genres: ruleGenres,
      tags: [],
      source: 'rule',
      message: llmUnavailableReason
        ? `${llmUnavailableReason}，已按关键词初步识别题材`
        : '已按关键词初步识别题材',
    };
  }

  return {
    genres: [],
    tags: [],
    source: 'none',
    message: llmUnavailableReason
      ? `${llmUnavailableReason}，请手动选择标签`
      : '未识别到合适的标签，请手动选择',
  };
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
    licenseType: (asset as { licenseType?: string | null }).licenseType as PublicAssetDetailResponse['licenseType'],
    attributionRequired: (asset as { attributionRequired?: boolean }).attributionRequired ?? false,
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
          // 拿取素材来源为导入（实施包 H2）：待审核，且不一定存在本书原文证据
          reviewSource: 'IMPORTED',
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
          // 拿取素材来源为导入（实施包 H2）：待审核，且不一定存在本书原文证据
          reviewSource: 'IMPORTED',
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
          // 拿取素材来源为导入（实施包 H2）：待审核，且不一定存在本书原文证据
          reviewSource: 'IMPORTED',
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
