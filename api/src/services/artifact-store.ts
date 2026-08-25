/**
 * 产物对象化读取 helper（api 侧）：优先从 BookArtifact + 对象存储读取，
 * 失败回退本机 output/（兼容旧数据 / 调试），都没有返回 null。
 *
 * 写入侧由 scheduler（提取）和 story.service（故事/导演）在写本机文件后
 * 调用 storage.persistBookArtifact 同步到对象存储 + BookArtifact。
 *
 * logicalPath 约定（不含 runDir，让最新 run 覆盖）：
 *   - 提取：entities/{filename}、run-summary.json
 *   - 故事：story-segments.json、stories/{storyId}/{filename}
 *   - 导演：stories/{storyId}/director/{filename}
 */
import { readFile } from 'node:fs/promises';
import { readBookArtifactJson, readBookArtifactText } from '@qunxiang/storage';

/**
 * 优先 BookArtifact + 对象存储读 JSON；失败回退 fsFallbackPath；都没有返回 null。
 * fsFallbackPath 为调用方按现有 runDir 发现逻辑构造的完整本机路径。
 */
export async function readArtifactJson<T = unknown>(
  bookId: string,
  logicalPath: string,
  fsFallbackPath?: string,
): Promise<T | null> {
  const text = await readArtifactText(bookId, logicalPath, fsFallbackPath);
  if (text === null) return null;
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[ArtifactStore] JSON 解析失败（${logicalPath}）：${msg}`);
    return null;
  }
}

/** 优先 BookArtifact + 对象存储读文本；失败回退本机 output/ fsFallbackPath。 */
export async function readArtifactText(
  bookId: string,
  logicalPath: string,
  fsFallbackPath?: string,
): Promise<string | null> {
  const fromStore = await readBookArtifactText(bookId, logicalPath);
  if (fromStore !== null) return fromStore;
  if (fsFallbackPath) {
    try {
      return await readFile(fsFallbackPath, 'utf-8');
    } catch {
      return null;
    }
  }
  return null;
}
