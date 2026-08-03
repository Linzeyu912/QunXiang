import { createHash } from 'node:crypto';
import { stableStringify } from './stable-json.js';

export const MANIFEST_SCHEMA_VERSION = '1';

export type AssetState = 'present' | 'empty' | 'not-generated';

export interface ManifestFile {
  logicalPath: string;
  bytes: number;
  mime: string;
  etag?: string;
  versionId?: string;
  sha256: string;
}

export interface ManifestAssetCategory {
  category: string;
  state: AssetState;
  reason?: string;
}

export interface Manifest {
  schemaVersion: string;
  bookId: string;
  snapshotId: string;
  generatedAt: string;
  sourceType: string;
  categories: ManifestAssetCategory[];
  files: ManifestFile[];
}

const MANIFEST_PATH_CONTROL_RE = /[\x00-\x1f\x7f]/;
const MANIFEST_PATH_DRIVE_RE = /^[A-Za-z]:[\\/]|:\/\//;

/** 清单相对路径安全：拒绝绝对路径、盘符、反斜杠、点段、控制字符。 */
export function assertSafeManifestPath(logicalPath: string): void {
  if (typeof logicalPath !== 'string' || logicalPath.length === 0) {
    throw new Error('清单路径不能为空');
  }
  if (logicalPath[0] === '/' || logicalPath[0] === '\\') {
    throw new Error('清单路径不能为绝对路径');
  }
  if (logicalPath.includes('\\')) {
    throw new Error('清单路径不能包含反斜杠');
  }
  if (MANIFEST_PATH_DRIVE_RE.test(logicalPath)) {
    throw new Error('清单路径不能包含盘符或协议');
  }
  if (MANIFEST_PATH_CONTROL_RE.test(logicalPath)) {
    throw new Error('清单路径不能包含控制字符');
  }
  for (const seg of logicalPath.split('/')) {
    if (seg.length === 0) throw new Error('清单路径不能包含空段');
    if (seg === '.' || seg === '..') throw new Error('清单路径不能包含点段');
  }
}

export interface BuildManifestInput {
  bookId: string;
  snapshotId: string;
  generatedAt: string;
  sourceType: string;
  categories: ManifestAssetCategory[];
  files: ManifestFile[];
}

/** 组装 manifest：校验所有相对路径，文件按 logicalPath 排序。 */
export function buildManifest(input: BuildManifestInput): Manifest {
  for (const f of input.files) assertSafeManifestPath(f.logicalPath);
  const files = [...input.files].sort((a, b) => a.logicalPath.localeCompare(b.logicalPath));
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    bookId: input.bookId,
    snapshotId: input.snapshotId,
    generatedAt: input.generatedAt,
    sourceType: input.sourceType,
    categories: input.categories,
    files,
  };
}

export function manifestStableString(manifest: Manifest): string {
  return stableStringify(manifest);
}

export function manifestSha256(manifest: Manifest): string {
  return createHash('sha256').update(manifestStableString(manifest), 'utf8').digest('hex');
}
