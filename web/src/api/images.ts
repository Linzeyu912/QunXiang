import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';
import type { EntityImageMeta, EntityType } from '@/types';

export const imageKeys = {
  list: (bookId: string, type: EntityType, name: string) =>
    ['entity-images', bookId, type, name] as const,
};

/** 鉴权获取图片并转为仅当前页面可用的 Blob URL，卸载时立即释放。 */
export function useProtectedImageUrl(bookId: string, imageId: string): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    setUrl(null);
    const controller = new AbortController();
    let objectUrl: string | null = null;
    let disposed = false;

    void apiFetch<Response>(`/books/${bookId}/entity-images/${imageId}`, {
      raw: true,
      signal: controller.signal,
    }).then((response) => response.blob()).then((blob) => {
      objectUrl = URL.createObjectURL(blob);
      if (disposed) {
        URL.revokeObjectURL(objectUrl);
        return;
      }
      setUrl(objectUrl);
    }).catch((error) => {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setUrl(null);
    });

    return () => {
      disposed = true;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [bookId, imageId]);

  return url;
}

/** 画廊列表（挂载即查，解决刷新后已生成图片不显示的问题）。 */
export function useEntityImages(bookId: string, type: EntityType, name: string) {
  return useQuery({
    queryKey: imageKeys.list(bookId, type, name),
    queryFn: () =>
      apiFetch<{ images: EntityImageMeta[] }>(
        `/books/${bookId}/images/${type}/${encodeURIComponent(name)}`,
      ).then((r) => r.images),
    enabled: !!bookId && !!type && !!name,
    staleTime: 30_000,
  });
}

/** AI 生成一张（画廊新增）。outfit 指定服饰套系（scene 标签，仅角色）。 */
export function useGenerateImage(bookId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      type,
      name,
      aspectRatio,
      stage,
      outfit,
    }: {
      type: EntityType;
      name: string;
      aspectRatio?: string;
      stage?: string;
      outfit?: string;
    }) => {
      const params = new URLSearchParams();
      if (aspectRatio) params.set('aspectRatio', aspectRatio);
      if (stage) params.set('stage', stage);
      if (outfit) params.set('outfit', outfit);
      const qs = params.toString() ? `?${params}` : '';
      return apiFetch<EntityImageMeta>(
        `/books/${bookId}/images/${type}/${encodeURIComponent(name)}${qs}`,
        { method: 'POST' },
      );
    },
    onSuccess: (_d, vars) =>
      qc.invalidateQueries({ queryKey: imageKeys.list(bookId, vars.type, vars.name) }),
  });
}

/** 用户上传一张（FormData，client.ts 自动透传 boundary；画廊新增）。 */
export function useUploadImage(bookId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ type, name, file }: { type: EntityType; name: string; file: File }) => {
      const fd = new FormData();
      fd.append('file', file);
      return apiFetch<EntityImageMeta>(
        `/books/${bookId}/images/${type}/${encodeURIComponent(name)}/upload`,
        { method: 'POST', body: fd },
      );
    },
    onSuccess: (_d, vars) =>
      qc.invalidateQueries({ queryKey: imageKeys.list(bookId, vars.type, vars.name) }),
  });
}

/** 删单张。vars 带 type/name 以便失效画廊查询。 */
export function useDeleteImage(bookId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ imageId }: { imageId: string; type: EntityType; name: string }) =>
      apiFetch(`/books/${bookId}/entity-images/${imageId}`, { method: 'DELETE' }),
    onSuccess: (_d, vars) =>
      qc.invalidateQueries({ queryKey: imageKeys.list(bookId, vars.type, vars.name) }),
  });
}

/** 设主图。vars 带 type/name 以便失效画廊查询。 */
export function useSetPrimaryImage(bookId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ imageId }: { imageId: string; type: EntityType; name: string }) =>
      apiFetch<EntityImageMeta>(
        `/books/${bookId}/entity-images/${imageId}/primary`,
        { method: 'PATCH' },
      ),
    onSuccess: (_d, vars) =>
      qc.invalidateQueries({ queryKey: imageKeys.list(bookId, vars.type, vars.name) }),
  });
}
