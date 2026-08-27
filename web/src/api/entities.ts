import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';
import type {
  AnyEntity,
  Character,
  CharacterReview,
  EntityStatus,
  EntityType,
  ItemEntity,
  LocationEntity,
  Tier,
  WorldviewSynthesis,
} from '@/types';

const PATHS: Record<EntityType, string> = {
  character: '/characters',
  location: '/locations',
  item: '/items',
  worldview: '/worldview',
};

const KEYS: Record<EntityType, string> = {
  character: 'characters',
  location: 'locations',
  item: 'items',
  worldview: 'worldviews',
};

export const entitiesKey = {
  all: (bookId: string) => ['entities', bookId] as const,
  list: (type: EntityType, bookId: string, filters?: { status?: EntityStatus; tier?: Tier; category?: string; confidence?: 'low'; reviewBucket?: 'MAIN' | 'LOW_CONFIDENCE' | 'REJECTED' }) => {
    // 将 filters 序列化为稳定字符串，避免对象引用变化导致缓存键不稳定
    const filterKey = filters ? JSON.stringify(filters) : '';
    return ['entities', bookId, type, filterKey] as const;
  },
  reviews: (id: string) => ['character-reviews', id] as const,
  mergeCandidates: (bookId: string) => ['character-merge-candidates', bookId] as const,
};

export interface CharacterMergeCandidate {
  primaryId: string;
  secondaryId: string;
  reasons: string[];
  primary: { id: string; name: string; aliases: string[]; description?: string; chapterAppearances: number[] };
  secondary: { id: string; name: string; aliases: string[]; description?: string; chapterAppearances: number[] };
}

export interface MergeSuggestion {
  primaryId: string;
  secondaryId: string;
  verdict: 'same' | 'different' | 'uncertain';
  confidence: number;
  reason?: string;
}

export function useCharacterMergeCandidates(bookId: string | undefined) {
  return useQuery({
    queryKey: bookId ? entitiesKey.mergeCandidates(bookId) : ['character-merge-candidates', 'none'],
    queryFn: () => apiFetch<{ candidates: CharacterMergeCandidate[]; suggestions: MergeSuggestion[] }>(`/characters/merge-candidates?bookId=${encodeURIComponent(bookId!)}`),
    enabled: !!bookId,
  });
}

export interface MergePreview {
  keep: { id: string; name: string; description?: string | null; status: string };
  mergeInto: { id: string; name: string };
  mergedFields: Array<{ field: string; strategy: string; value: string }>;
}

export function useMergePreview(bookId: string | undefined, primaryId?: string, secondaryId?: string) {
  return useQuery({
    queryKey: ['character-merge-preview', primaryId, secondaryId],
    queryFn: () => apiFetch<{ preview: MergePreview }>(`/characters/merge-candidates/preview?primaryId=${primaryId}&secondaryId=${secondaryId}`).then((r) => r.preview),
    enabled: !!bookId && !!primaryId && !!secondaryId,
  });
}

function useCharacterMergeDecision(bookId: string, decision: 'accept' | 'reject') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ primaryId, secondaryId }: { primaryId: string; secondaryId: string }) =>
      apiFetch(`/characters/merge-candidates/${primaryId}/${decision}`, { method: 'POST', body: { secondaryId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: entitiesKey.all(bookId) });
      qc.invalidateQueries({ queryKey: entitiesKey.mergeCandidates(bookId) });
    },
  });
}

export function useAcceptCharacterMerge(bookId: string) { return useCharacterMergeDecision(bookId, 'accept'); }
export function useRejectCharacterMerge(bookId: string) { return useCharacterMergeDecision(bookId, 'reject'); }

interface ListParams {
  status?: EntityStatus;
  tier?: Tier;
  /** 道具大类过滤（仅 item 类型有效） */
  category?: string;
  /** 只取低置信度待审核实体（低置信度库，兼容别名） */
  confidence?: 'low';
  /** 审核集合：主列表 / 低置信度库 / 已拒绝列表（新参数） */
  reviewBucket?: 'MAIN' | 'LOW_CONFIDENCE' | 'REJECTED';
}

function buildQuery(bookId: string, params?: ListParams): string {
  const sp = new URLSearchParams();
  sp.set('bookId', bookId);
  if (params?.status) sp.set('status', params.status);
  if (params?.tier) sp.set('tier', params.tier);
  if (params?.category) sp.set('category', params.category);
  if (params?.confidence) sp.set('confidence', params.confidence);
  if (params?.reviewBucket) sp.set('reviewBucket', params.reviewBucket);
  return sp.toString();
}

export function useEntities<T extends AnyEntity = AnyEntity>(
  type: EntityType,
  bookId: string | undefined,
  filters?: ListParams,
) {
  return useQuery({
    queryKey: bookId ? entitiesKey.list(type, bookId, filters) : ['entities', 'none'],
    queryFn: async () => {
      const key = KEYS[type];
      const res = await apiFetch<Record<string, T[]>>(
        `${PATHS[type]}?${buildQuery(bookId!, filters)}`,
      );
      return res[key] ?? [];
    },
    enabled: !!bookId,
  });
}

export function useCharacters(bookId: string | undefined, filters?: ListParams) {
  return useEntities<Character>('character', bookId, filters);
}

export function useLocations(bookId: string | undefined, filters?: ListParams) {
  return useEntities<LocationEntity>('location', bookId, filters);
}

export function useItems(bookId: string | undefined, filters?: ListParams) {
  return useEntities<ItemEntity>('item', bookId, filters);
}

interface EntityPatch {
  name?: string;
  aliases?: string[];
  description?: string;
  status?: EntityStatus;
  /** 道具大类（仅 item） */
  category?: string;
}

export function useUpdateEntity(type: EntityType, bookId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: EntityPatch }) => {
      const key = type === 'character'
        ? 'character'
        : type === 'location'
          ? 'location'
          : type === 'worldview'
            ? 'worldview'
            : 'item';
      const res = await apiFetch<Record<string, AnyEntity>>(`${PATHS[type]}/${id}`, {
        method: 'PATCH',
        body: patch,
      });
      return res[key];
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: entitiesKey.all(bookId) });
    },
  });
}

export function useCharacterReviews(id: string | undefined) {
  return useQuery({
    queryKey: id ? entitiesKey.reviews(id) : ['character-reviews', 'none'],
    queryFn: () =>
      apiFetch<{ reviews: CharacterReview[] }>(`/characters/${id}/reviews`).then((r) => r.reviews),
    enabled: !!id,
  });
}

/** 人工通过后的独立补写：入队后台任务生成描述（实施包 A3）。 */
export function useRequestEnrichment(type: EntityType, bookId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ queued: boolean; jobId: string }>(`${PATHS[type]}/${id}/enrichment`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: entitiesKey.all(bookId) });
    },
  });
}

/** 批量改实体状态（后端 POST /{type}/batch，一次请求替代 N 次 PATCH）。 */
export function useBatchUpdateStatus(type: EntityType, bookId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, status }: { ids: string[]; status: 'APPROVED' | 'REJECTED' }) =>
      apiFetch<{ updated: string[]; skipped: { id: string; reason: string }[] }>(
        `${PATHS[type]}/batch`,
        { method: 'POST', body: { ids, status } },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: entitiesKey.all(bookId) });
    },
  });
}

/** LLM 智能裁决疑似重复角色对的结果。 */
export interface MergeJudgeOutcome {
  /** 模型建议同一角色（仅建议，待人工确认合并） */
  suggestedMerge: Array<{ primary: string; secondary: string; confidence: number; reason?: string }>;
  /** 模型建议不同角色（仅建议，待人工确认保持独立） */
  suggestedSeparate: Array<{ primary: string; secondary: string; confidence: number; reason?: string }>;
  /** 无法确定，仍需人工判断 */
  pending: Array<{ primary: string; secondary: string }>;
  /** 降级/限制提示（模型未配置、候选过多等） */
  message?: string;
}

/** 让模型对疑似重复角色对给出建议（不自动合并/排除，全部由人工确认）。 */
export function useJudgeCharacterMerges(bookId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<MergeJudgeOutcome>('/characters/merge-candidates/llm-judge', {
        method: 'POST',
        body: { bookId },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: entitiesKey.all(bookId) });
      qc.invalidateQueries({ queryKey: entitiesKey.mergeCandidates(bookId) });
    },
  });
}

/** 让模型读取正文并生成结构化世界观梳理。 */
export function useWorldviewSynthesis(bookId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ synthesis: WorldviewSynthesis }>('/worldview/synthesize', {
      method: 'POST',
      body: { bookId },
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['worldview-synthesis', bookId] });
    },
  });
}

/** 获取已保存的世界观梳理结果。 */
export function useWorldviewSynthesisResult(bookId: string | undefined) {
  return useQuery({
    queryKey: bookId ? ['worldview-synthesis', bookId] : ['worldview-synthesis', 'none'],
    queryFn: async (): Promise<WorldviewSynthesis | null> => {
      const result = await apiFetch<{ synthesis: WorldviewSynthesis | null }>(
        `/worldview/synthesis?bookId=${bookId}`,
      );
      return result.synthesis ?? null;
    },
    enabled: !!bookId,
  });
}
