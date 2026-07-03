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
} from '@/types';

const PATHS: Record<EntityType, string> = {
  character: '/characters',
  location: '/locations',
  item: '/items',
};

const KEYS: Record<EntityType, string> = {
  character: 'characters',
  location: 'locations',
  item: 'items',
};

export const entitiesKey = {
  all: (bookId: string) => ['entities', bookId] as const,
  list: (type: EntityType, bookId: string, filters?: { status?: EntityStatus; tier?: Tier }) =>
    ['entities', bookId, type, filters ?? {}] as const,
  reviews: (id: string) => ['character-reviews', id] as const,
};

interface ListParams {
  status?: EntityStatus;
  tier?: Tier;
}

function buildQuery(bookId: string, params?: ListParams): string {
  const sp = new URLSearchParams();
  sp.set('bookId', bookId);
  if (params?.status) sp.set('status', params.status);
  if (params?.tier) sp.set('tier', params.tier);
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
}

export function useUpdateEntity(type: EntityType, bookId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: EntityPatch }) => {
      const key = type === 'character' ? 'character' : type === 'location' ? 'location' : 'item';
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
