import { readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getDefaultImageProvider, getRuntimeImageConfig } from '@novel-agent/llm';
import { BookRepository, EntityImageRepository, getSharedObjectStore, type EntityImageRow } from '@novel-agent/storage';
import { listExtractionRuns } from './artifacts.service.js';
import { readArtifactText } from './artifact-store.js';
import { ENTITY_IMAGE_DIR } from '../lib/paths.js';

/**
 * 实体一键生图服务（多张画廊 + DB 持久化）。
 *
 * 图片产物与提取 runDir 解耦：
 *   - prompt 仍从最新 runDir 的 entities/{type}-prompts.json 读（生成输入）
 *   - 图片本身落到稳定目录 storage/uploads/entity-images/{bookId}/{type}/{fileUuid}.{ext}
 *   - 元数据写入 EntityImage 表（bookId+type+name 索引），重跑管道不丢
 *
 * 文件名用独立 fileUuid（与 DB 主键 id 解耦）；二进制读取按 DB id 查行再用 row.filePath。
 */

const OUTPUT_ROOT = 'output';

const PROMPTS_FILE: Record<EntityType, string> = {
  character: 'character-prompts.json',
  item: 'item-prompts.json',
  location: 'location-prompts.json',
};

const DEFAULT_RATIO: Record<EntityType, string> = {
  character: '3:4',
  item: '1:1',
  location: '16:9',
};

/** Resolve default aspect ratio: runtime config > env var > hardcoded default */
function getDefaultRatio(entityType: EntityType): string {
  const rt = getRuntimeImageConfig();
  if (rt) {
    switch (entityType) {
      case 'character': if (rt.characterRatio) return rt.characterRatio; break;
      case 'item': if (rt.itemRatio) return rt.itemRatio; break;
      case 'location': if (rt.locationRatio) return rt.locationRatio; break;
    }
  }
  return process.env[`IMAGE_DEFAULT_RATIO_${entityType.toUpperCase()}`] || DEFAULT_RATIO[entityType];
}

export type EntityType = 'character' | 'item' | 'location';

/** 前端友好的图片元数据（不含磁盘路径）。 */
export interface EntityImageMeta {
  id: string;
  entityType: EntityType;
  entityName: string;
  mime: string;
  ext: string;
  bytes: number;
  aspectRatio: string | null;
  source: 'generated' | 'uploaded';
  stage: string | null;
  isPrimary: boolean;
  createdAt: string;
}

export class ImageGenerationError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = 'ImageGenerationError';
  }
}

interface PromptEntry {
  entityName?: string;
  entityType?: string;
  tier?: string;
  prompt?: string;
}

const ALLOWED_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp']);

function toMeta(row: EntityImageRow): EntityImageMeta {
  return {
    id: row.id,
    entityType: row.entityType as EntityType,
    entityName: row.entityName,
    mime: row.mime,
    ext: row.ext,
    bytes: row.bytes,
    aspectRatio: row.aspectRatio,
    source: row.source as 'generated' | 'uploaded',
    stage: row.stage,
    isPrimary: row.isPrimary,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
  };
}

/** 该书所有图片的存储根目录（删书时 rm）。 */
export function bookImageDir(bookId: string): string {
  return join(ENTITY_IMAGE_DIR, bookId);
}

/** 反查 bookId 最新一次官方运行的 runDir。 */
async function resolveLatestRunDir(bookId: string, ownerId: string): Promise<string> {
  const { runs } = await listExtractionRuns(bookId, ownerId);
  const latest = runs.find(r => r.isCurrent) || runs[0];
  if (!latest) {
    throw new ImageGenerationError(
      `书籍 ${bookId} 尚无提取结果，请先运行提取流程。`,
      'NO_RUN'
    );
  }
  return latest.runDir;
}

/** 从 *-prompts.json 读出指定实体的 prompt（优先 BookArtifact + 对象存储，回退本机 output/）。
 * outfit 指定时优先取服饰套系变体（outfitVariants，按 scene/描述匹配）。 */
async function readEntityPrompt(
  bookId: string,
  runDir: string,
  entityType: EntityType,
  entityName: string,
  stage?: string,
  outfit?: string,
): Promise<string> {
  const filename = PROMPTS_FILE[entityType];
  const file = join(OUTPUT_ROOT, runDir, 'entities', filename);
  const raw = await readArtifactText(bookId, `entities/${filename}`, file);
  if (raw === null) {
    throw new ImageGenerationError(
      `未找到图片提示词文件：${file}，请先完成提示词生成阶段。`,
      'NO_PROMPTS_FILE'
    );
  }
  let entries: any[];
  try {
    entries = JSON.parse(raw);
  } catch {
    throw new ImageGenerationError(`图片提示词文件损坏：${file}`, 'BAD_PROMPTS_JSON');
  }
  const hit = entries.find(e => e.entityName === entityName);
  if (!hit) {
    throw new ImageGenerationError(
      `未在 ${file} 中找到实体 ${entityType}“${entityName}”的提示词`,
      'NO_PROMPT_FOR_ENTITY'
    );
  }
  // 服饰套系变体：按 scene/描述匹配 outfit；未命中时报错提示重跑提示词阶段
  if (outfit) {
    const outfitVariants: Array<{ scene?: string; description?: string; prompt?: string }> =
      Array.isArray(hit.outfitVariants) ? hit.outfitVariants : [];
    const picked = outfitVariants.find((v) => v.scene === outfit)
      ?? outfitVariants.find((v) => v.description === outfit)
      ?? outfitVariants.find((v) => typeof v.scene === 'string' && (v.scene as string).includes(outfit));
    if (!picked?.prompt) {
      throw new ImageGenerationError(
        `未在 ${file} 中找到“${entityName}”的服饰套系“${outfit}”提示词，请重新运行提示词生成阶段。`,
        'NO_PROMPT_FOR_OUTFIT'
      );
    }
    return picked.prompt;
  }
  // 多年龄阶段版本：按 stage 选 variant；无 stage 取主 variant；再回退顶层 prompt（向后兼容旧产物）
  const variants: any[] | undefined = Array.isArray(hit.variants) ? hit.variants : undefined;
  if (variants) {
    const picked = (stage ? variants.find((v) => v.stage === stage) : undefined)
      ?? variants.find((v) => v.isPrimary);
    if (picked?.prompt) return picked.prompt;
  }
  if (!hit.prompt) {
    throw new ImageGenerationError(
      `未在 ${file} 中找到实体 ${entityType}“${entityName}”的提示词`,
      'NO_PROMPT_FOR_ENTITY'
    );
  }
  return hit.prompt;
}

function imageExtFromMime(mime: string): string {
  if (mime.includes('png')) return 'png';
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  if (mime.includes('webp')) return 'webp';
  return 'png';
}

/** 落盘 + 入库（写盘失败回滚 DB 记录，避免悬空行）。 */
async function persistImage(
  bookId: string,
  ownerId: string,
  entityType: EntityType,
  entityName: string,
  buffer: Buffer,
  mime: string,
  source: 'generated' | 'uploaded',
  aspectRatio?: string | null,
  stage?: string | null,
): Promise<EntityImageMeta> {
  if (!(await BookRepository.findOwnedById(bookId, ownerId))) {
    throw new ImageGenerationError('书籍不存在或无权访问', 'NO_RUN');
  }
  if (!ALLOWED_MIMES.has(mime)) {
    throw new ImageGenerationError(
      `不支持图片类型 ${mime}，仅支持 PNG、JPEG 或 WebP。`,
      'UNSUPPORTED_MIME',
    );
  }
  const ext = imageExtFromMime(mime);
  let stored: { objectKey: string };
  try {
    stored = await getSharedObjectStore().put({ body: buffer, mime });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new ImageGenerationError(`写入图片对象失败：${msg}`, 'WRITE_FAILED');
  }

  // 先写库（objectKey 指向对象存储；filePath 留空，兼容期仅旧图有本地路径）。
  const row = await EntityImageRepository.create({
    bookId,
    entityType,
    entityName,
    filePath: '',
    objectKey: stored.objectKey,
    mime,
    ext,
    bytes: buffer.length,
    aspectRatio: aspectRatio ?? null,
    source,
    stage: stage ?? null,
  });
  return toMeta(row);
}

/** AI 生成一张图片并入库（画廊新增，source=generated）。
 * opts.outfit 指定服饰套系（scene 标签）时，取套系专属提示词生图，图片 stage 记为套系标签。 */
export async function generateEntityImage(
  bookId: string,
  ownerId: string,
  entityType: EntityType,
  entityName: string,
  opts: { aspectRatio?: string; stage?: string; outfit?: string } = {},
): Promise<EntityImageMeta> {
  const runDir = await resolveLatestRunDir(bookId, ownerId);
  const prompt = await readEntityPrompt(bookId, runDir, entityType, entityName, opts.stage, opts.outfit);
  const aspectRatio = opts.aspectRatio || getDefaultRatio(entityType);

  // 调 provider 生图
  const provider = getDefaultImageProvider();
  if (!provider.isConfigured()) {
    throw new ImageGenerationError(
      '图片服务尚未配置，请在设置页填写接口密钥、接口地址和模型名称。',
      'PROVIDER_NOT_CONFIGURED'
    );
  }

  let generated: { buffer: Buffer; mime: string };
  try {
    generated = await provider.generateImage(prompt, { aspectRatio });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new ImageGenerationError(`生成图片失败：${msg}`, 'GENERATION_FAILED');
  }

  return persistImage(bookId, ownerId, entityType, entityName, generated.buffer, generated.mime, 'generated', aspectRatio, opts.outfit || opts.stage);
}

/** 用户上传一张图片并入库（画廊新增，source=uploaded，aspectRatio=null 按原图）。 */
export async function uploadEntityImage(
  bookId: string,
  ownerId: string,
  entityType: EntityType,
  entityName: string,
  buffer: Buffer,
  mime: string,
): Promise<EntityImageMeta> {
  return persistImage(bookId, ownerId, entityType, entityName, buffer, mime, 'uploaded', null, null);
}

/** 该实体的画廊列表（主图优先 + 创建时间升序）。 */
export async function listEntityImages(
  bookId: string,
  ownerId: string,
  entityType: EntityType,
  entityName: string,
): Promise<EntityImageMeta[]> {
  if (!(await BookRepository.findOwnedById(bookId, ownerId))) return [];
  const rows = await EntityImageRepository.findManyByOwnedEntity(bookId, ownerId, entityType, entityName);
  return rows.map(toMeta);
}

/** 按 id 读取图片二进制（供路由直接回吐）。行不存在或文件丢失返回 null。 */
export async function readImageRaw(
  imageId: string,
  bookId: string,
  ownerId: string,
): Promise<{ buffer: Buffer; mime: string; ext: string; bookId: string } | null> {
  const row = await EntityImageRepository.findOwnedById(imageId, bookId, ownerId);
  if (!row) return null;
  let buffer: Buffer;
  try {
    if (row.objectKey) {
      buffer = Buffer.from((await getSharedObjectStore().get(row.objectKey)).bytes);
    } else if (row.filePath) {
      buffer = await readFile(row.filePath);
    } else {
      return null;
    }
  } catch {
    // 对象或文件丢失（不应发生）；不自动删行，返回 null 让路由 404
    return null;
  }
  return { buffer, mime: row.mime, ext: row.ext, bookId: row.bookId };
}

/** 按 id 删除一张图片：删文件（best-effort）+ 删 DB 记录；删的是主图则提升下一张。 */
export async function deleteEntityImageById(imageId: string, bookId: string, ownerId: string): Promise<boolean> {
  const row = await EntityImageRepository.findOwnedById(imageId, bookId, ownerId);
  if (!row) return false;
  await unlink(row.filePath).catch(() => {});
  if (!(await EntityImageRepository.deleteOwnedById(imageId, bookId, ownerId))) return false;
  if (row.isPrimary) {
    await EntityImageRepository.promoteOldestPrimary(row.bookId, row.entityType, row.entityName);
  }
  return true;
}

/** 设某张为主图（事务清同实体其他主图）。行不存在返回 null。 */
export async function setPrimaryImage(imageId: string, bookId: string, ownerId: string): Promise<EntityImageMeta | null> {
  const row = await EntityImageRepository.setOwnedPrimary(imageId, bookId, ownerId);
  return row ? toMeta(row) : null;
}
