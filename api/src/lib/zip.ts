import { zipSync } from 'fflate';
import { assertSafeManifestPath } from './manifest.js';

export interface ArchiveEntry {
  logicalPath: string;
  body: Uint8Array;
}

/**
 * 生成确定性 ZIP：条目按 logicalPath 排序、固定压缩级别。
 * fflate zipSync 为纯函数，文件 mtime 默认为 DOS 纪元 0，同一输入永远产生同一字节序列。
 */
export async function createArchiveZip(entries: ArchiveEntry[]): Promise<Buffer> {
  const sorted = [...entries].sort((a, b) => a.logicalPath.localeCompare(b.logicalPath));
  for (const entry of sorted) assertSafeManifestPath(entry.logicalPath);

  const files: Record<string, Uint8Array> = {};
  for (const entry of sorted) {
    files[entry.logicalPath] = entry.body;
  }
  const zipped = zipSync(files, { level: 9 });
  return Buffer.from(zipped);
}
