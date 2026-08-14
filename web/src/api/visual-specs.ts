import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './client';
import type { EntityType } from '@/types';

export interface VisualSpecDto {
  id: string;
  entityType: string;
  entityName: string;
  variantKey: string;
  version: number;
  status: string;
  prompt: string;
  promptSource: string;
  quality: string | null;
  styleTags: string[];
  model: string | null;
  primaryImageId: string | null;
  sourceChapters: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

export const visualSpecKeys = {
  list: (bookId: string, type: EntityType, name: string) =>
    ['visual-specs', bookId, type, name] as const,
};

export function useVisualSpecs(bookId: string, type: EntityType, name: string) {
  const enabled = Boolean(bookId && name && type !== 'worldview');
  return useQuery({
    queryKey: visualSpecKeys.list(bookId, type, name),
    queryFn: () => apiFetch<{ specs: VisualSpecDto[] }>(
      `/books/${bookId}/visual-specs/${type}/${encodeURIComponent(name)}`,
    ).then((r) => r.specs),
    enabled,
  });
}
