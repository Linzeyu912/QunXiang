import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';
import type { BookDownloadState } from '@/types';

export const downloadStateKey = {
  forBook: (id: string) => ['books', id, 'download-state'] as const,
};

/** 查询下载状态；准备中持续轮询，终态停止。 */
export function useBookDownloadState(bookId: string) {
  return useQuery({
    queryKey: downloadStateKey.forBook(bookId),
    queryFn: () => apiFetch<BookDownloadState>(`/books/${bookId}/download-state`),
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return 4000;
      if (data.state === 'preparing') return 3000;
      return false;
    },
  });
}

export function usePrepareDownload(bookId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{ snapshotId: string; state: string }>(`/books/${bookId}/snapshots`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: downloadStateKey.forBook(bookId) }),
  });
}

export interface DownloadAuthorization {
  url: string;
  expiresAt: string;
  etag?: string;
  bytes?: number;
}

/** 请求短时签名下载地址（仅 ready 快照）。 */
export function useRequestDownload(bookId: string, snapshotId: string | undefined) {
  return useMutation({
    mutationFn: () => {
      if (!snapshotId) throw new Error('数据包尚未准备完成');
      return apiFetch<DownloadAuthorization>(
        `/books/${bookId}/snapshots/${snapshotId}/download-authorizations`,
        { method: 'POST' },
      );
    },
  });
}
