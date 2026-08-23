import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';
import type { EntityType, PublicAssetListItem, PublicAssetDetail } from '@/types';

export interface PublicAssetListResult {
  items: PublicAssetListItem[];
  nextCursor: { createdAt: string; id: string } | null;
}

export const publicAssetKeys = {
  list: (params: { kind?: string; sort?: string; q?: string; tags?: string[] }) => {
    // 将 params 序列化为稳定字符串，避免对象引用变化导致缓存键不稳定
    const paramKey = JSON.stringify(params);
    return ['public-assets', 'list', paramKey] as const;
  },
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

/** 发布前标签智能识别结果 */
export interface SuggestPublishTagsResult {
  /** 题材标签（预置白名单内） */
  genres: string[];
  /** 自定义内容标签 */
  tags: string[];
  /** 识别来源：llm = 模型识别；rule = 关键词兜底；none = 未识别到 */
  source: 'llm' | 'rule' | 'none';
  /** 降级/未识别原因 */
  message?: string;
}

/** 发布前标签智能识别（对话框打开时调用，失败不阻断发布流程） */
export function useSuggestPublishTags(params: {
  open: boolean;
  bookId: string;
  entityType: EntityType;
  entityId: string;
}) {
  return useQuery({
    queryKey: ['public-assets', 'suggest-tags', params.bookId, params.entityType, params.entityId],
    queryFn: () =>
      apiFetch<SuggestPublishTagsResult>('/public-assets/suggest-tags', {
        method: 'POST',
        body: {
          bookId: params.bookId,
          entityType: params.entityType,
          entityId: params.entityId,
        },
      }),
    enabled: params.open && !!params.bookId && !!params.entityId,
    staleTime: 5 * 60 * 1000, // 5 分钟内重复打开同一实体的发布框不重复调模型
    retry: false, // 模型调用失败不自动重试，避免无谓消耗；可手动点“重新识别”
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
