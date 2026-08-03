/**
 * 产物对象化（方案 A，整文件粒度）：把本机 output/ 的提取/故事/导演产物
 * 同步到对象存储 + BookArtifact 表，使服务无状态。
 *
 * 本模块协调 ObjectStore + BookArtifactRepository 两个原语：
 *   - persistBookArtifact：put 字节 → upsert (bookId, logicalPath) 记录
 *   - readBookArtifactText/Json：findByBookAndPath → objectStore.get → 解析
 *
 * (bookId, logicalPath) 唯一，最新写入覆盖；多设备经 DB + 对象存储定位最新产物。
 *
 * 错误语义：persist 为 best-effort——本机 output/ 已先行写入（双写过渡），
 * 对象存储失败仅记录不抛，避免破坏现有管道；read 失败由调用方走本机回退。
 */
import { Buffer } from 'node:buffer';
import { BookArtifactRepository } from './book-artifact.repository.js';
import { getSharedObjectStore } from './object-storage/index.js';

export interface PersistBookArtifactInput {
  bookId: string;
  /** 稳定相对路径（不含 runDir），如 entities/character-descriptions.json、run-summary.json、stories/{storyId}/story.json。 */
  logicalPath: string;
  /** extraction / run-summary / story / director。 */
  category: string;
  /** 文件字节；字符串按 utf-8 编码。 */
  body: Uint8Array | string;
  /** 未传时默认 application/json。 */
  mime?: string;
}

const DEFAULT_JSON_MIME = 'application/json';

/**
 * 把字节写入对象存储 + BookArtifact 表（latest-wins upsert）。
 * best-effort：对象存储 / DB 任一失败仅 console.warn，不抛出。
 */
export async function persistBookArtifact(input: PersistBookArtifactInput): Promise<void> {
  const body = typeof input.body === 'string' ? Buffer.from(input.body, 'utf-8') : input.body;
  const mime = input.mime ?? DEFAULT_JSON_MIME;
  try {
    const stored = await getSharedObjectStore().put({ body, mime });
    await BookArtifactRepository.upsert({
      bookId: input.bookId,
      logicalPath: input.logicalPath,
      category: input.category,
      objectKey: stored.objectKey,
      sha256: stored.sha256,
      bytes: stored.bytes,
      mime,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[BookArtifactStore] 写入对象存储失败（${input.logicalPath}）：${msg}`);
  }
}

/**
 * 从 BookArtifact + 对象存储读取文本。无记录或对象丢失返回 null（不抛）。
 * 本机 output/ 回退由 api 层的 artifact-store 包装处理（storage 不感知 output/ 约定）。
 */
export async function readBookArtifactText(bookId: string, logicalPath: string): Promise<string | null> {
  try {
    const artifact = await BookArtifactRepository.findByBookAndPath(bookId, logicalPath);
    if (!artifact) return null;
    const body = await getSharedObjectStore().get(artifact.objectKey);
    return Buffer.from(body.bytes).toString('utf-8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[BookArtifactStore] 读取对象存储失败（${logicalPath}）：${msg}`);
    return null;
  }
}

/** 从 BookArtifact + 对象存储读取并 JSON.parse；失败或无记录返回 null。 */
export async function readBookArtifactJson<T = unknown>(bookId: string, logicalPath: string): Promise<T | null> {
  const text = await readBookArtifactText(bookId, logicalPath);
  if (text === null) return null;
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[BookArtifactStore] JSON 解析失败（${logicalPath}）：${msg}`);
    return null;
  }
}
