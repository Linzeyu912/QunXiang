import { apiFetch } from './client';
import type { EntityType } from '@/types';

export type ExportFormat = 'json' | 'markdown' | 'csv';
export type ExportType = EntityType; // character | location | item | worldview

export function getExportUrl(bookId: string, format: ExportFormat, type: ExportType = 'character'): string {
  const params = new URLSearchParams({ format, type });
  return `/export/${bookId}?${params.toString()}`;
}

export async function fetchExportPreview(
  bookId: string,
  format: ExportFormat,
  type: ExportType = 'character',
): Promise<string> {
  const res = await apiFetch<Response>(getExportUrl(bookId, format, type), { raw: true });
  return res.text();
}

/** 鉴权下载导出文件，不把访问令牌放入 URL。 */
export async function downloadExport(
  bookId: string,
  format: ExportFormat,
  type: ExportType = 'character',
): Promise<void> {
  const response = await apiFetch<Response>(getExportUrl(bookId, format, type), { raw: true });
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = `entities-${type}.${format === 'markdown' ? 'md' : format}`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}
