import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';
import type { EntityType, PublicAssetListItem, PublicAssetDetail } from '@/types';

export interface PublicAssetListResult {
  items: PublicAssetListItem[];
  nextCursor: { createdAt: string; id: string } | null;
}

export const publicAssetKeys = {
  list: (params: { kind?: string; sort?: string; q?: string; tags?: string[] }) =>
    ['public-assets', 'list', params] as const,
  mine: ['public-assets', 'mine'] as const,
  tags: ['public-assets', 'tags'] as const,
  detail: (id: string) => ['public-assets', 'detail', id] as const,
};

/** 浏览公共池 */
export function usePublicAssets(params: {
  kind?: string;
  sort?: string;
  q?: string;
  tags?: string[];
}) {
  return useQuery({
    queryKey: publicAssetKeys.list(params),
    queryFn: () => {
      const search = new URLSearchParams();
      if (params.kind) search.set('kind', params.kind);
      if (params.sort) search.set('sort', params.sort);
      if (params.q) search.set('q', params.q);
      if (params.tags) params.tags.forEach((t) => search.append('tags', t));
      const qs = search.toString();
      return apiFetch<PublicAssetListResult>(
        `/public-assets${qs ? `?${qs}` : ''}`,
      );
    },
  });
}

/** 热门标签聚合 */
export function usePopularTags() {
  return useQuery({
    queryKey: publicAssetKeys.tags,
    queryFn: () =>
      apiFetch<{ items: { tag: string; count: number }[] }>('/public-assets/tags'),
    staleTime: 5 * 60 * 1000, // 5 分钟缓存
  });
}

/** 我的发布 */
export function useMyPublicAssets() {
  return useQuery({
    queryKey: publicAssetKeys.mine,
    queryFn: () =>
      apiFetch<{ items: PublicAssetListItem[] }>('/public-assets/mine').then((r) => r.items),
  });
}

/** 详情 */
export function usePublicAssetDetail(id: string | undefined) {
  return useQuery({
    queryKey: id ? publicAssetKeys.detail(id) : ['public-assets', 'detail', 'none'],
    queryFn: () => apiFetch<PublicAssetDetail>(`/public-assets/${id}`),
    enabled: !!id,
  });
}

/** 发布 */
export function usePublishAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      bookId: string;
      entityType: EntityType;
      entityId: string;
      summary?: string;
      tags?: string[];
      showSource?: boolean;
    }) => apiFetch<{ id: string }>(`/public-assets`, { method: 'POST', body: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['public-assets'] });
    },
  });
}

/** 拿取 */
export function useTakeAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ assetId, targetBookId }: { assetId: string; targetBookId: string }) =>
      apiFetch<{ entityId: string; entityName: string }>(
        `/public-assets/${assetId}/take`,
        { method: 'POST', body: { targetBookId } },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['public-assets'] });
    },
  });
}

/** 下架 */
export function useUnlistAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (assetId: string) =>
      apiFetch(`/public-assets/${assetId}/unlist`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['public-assets'] });
    },
  });
}
