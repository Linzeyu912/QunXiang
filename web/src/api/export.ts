import { getToken } from '@/store/authStore';
import type { EntityType } from '@/types';

export type ExportFormat = 'json' | 'markdown' | 'csv';
export type ExportType = EntityType; // character | location | item

export function getExportUrl(bookId: string, format: ExportFormat, type: ExportType = 'character'): string {
  const params = new URLSearchParams({ format, type });
  return `/export/${bookId}?${params.toString()}`;
}

export async function fetchExportPreview(
  bookId: string,
  format: ExportFormat,
  type: ExportType = 'character',
): Promise<string> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(getExportUrl(bookId, format, type), { headers });
  if (!res.ok) {
    throw new Error(`导出失败：${res.status}`);
  }
  return res.text();
}
