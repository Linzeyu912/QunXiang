import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';
import type {
  ChapterOutlineResponse,
  ChapterContentResponse,
  EntityArtifacts,
  EntityType,
  ExtractionArtifactsResponse,
  ExtractionRunInfo,
  PrescanArtifactsResponse,
} from '@/types';

export const artifactsKey = {
  all: (bookId: string) => ['artifacts', bookId] as const,
  chapters: (bookId: string) => ['artifacts', bookId, 'chapters'] as const,
  chapterContent: (bookId: string, index: number) => ['artifacts', bookId, 'chapter', index] as const,
  runs: (bookId: string) => ['artifacts', bookId, 'runs'] as const,
  prescan: (bookId: string) => ['artifacts', bookId, 'prescan'] as const,
};

export function useChapterOutline(bookId: string | undefined) {
  return useQuery({
    queryKey: bookId ? artifactsKey.chapters(bookId) : ['artifacts', 'none', 'chapters'],
    queryFn: () => apiFetch<ChapterOutlineResponse>(`/books/${bookId}/chapters`),
    enabled: !!bookId,
    staleTime: 5 * 60_000, // 原文不变则大纲不变（后端有 mtime 缓存）
  });
}

/** 单章清洗后正文（含噪声行高亮标记），按章懒加载。 */
export function useChapterContent(bookId: string | undefined, chapterIndex: number | null) {
  return useQuery({
    queryKey:
      bookId && chapterIndex !== null
        ? artifactsKey.chapterContent(bookId, chapterIndex)
        : ['artifacts', 'none', 'chapter'],
    queryFn: () => apiFetch<ChapterContentResponse>(`/books/${bookId}/chapters/${chapterIndex}`),
    enabled: !!bookId && chapterIndex !== null,
    staleTime: 5_000, // 找回后会刷新，staleTime 短一些
  });
}

/** 找回 / 取消找回某行噪声。restore=true 找回，false 取消。 */
export function useRestoreNoiseLine(bookId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ lineNum, restore }: { lineNum: number; restore: boolean }) =>
      apiFetch<{ ok: boolean }>(`/books/${bookId}/chapters/noise/restore`, {
        method: restore ? 'POST' : 'DELETE',
        body: { lineNum },
      }),
    onSuccess: (_data, _vars) => {
      // 大纲（统计/明细）和所有章正文都可能受影响，全部失效
      qc.invalidateQueries({ queryKey: artifactsKey.chapters(bookId) });
      qc.invalidateQueries({ queryKey: ['artifacts', bookId, 'chapter'] });
    },
  });
}

export function useExtractionRuns(bookId: string | undefined) {
  return useQuery({
    queryKey: bookId ? artifactsKey.runs(bookId) : ['artifacts', 'none', 'runs'],
    queryFn: () => apiFetch<{ runs: ExtractionRunInfo[] }>(`/books/${bookId}/extraction-runs`),
    enabled: !!bookId,
    staleTime: 60_000,
  });
}

export function usePrescanArtifacts(bookId: string | undefined) {
  return useQuery({
    queryKey: bookId ? artifactsKey.prescan(bookId) : ['artifacts', 'none', 'prescan'],
    queryFn: () => apiFetch<PrescanArtifactsResponse>(`/books/${bookId}/prescan-artifacts`),
    enabled: !!bookId,
    staleTime: 60_000,
  });
}

export function useExtractionArtifacts(bookId: string | undefined) {
  return useQuery({
    queryKey: bookId ? artifactsKey.all(bookId) : ['artifacts', 'none'],
    queryFn: () => apiFetch<ExtractionArtifactsResponse>(`/books/${bookId}/extraction-artifacts`),
    enabled: !!bookId,
    staleTime: 60_000, // 产物只随提取运行变化，无需频繁刷新
  });
}

const TYPE_BUCKET: Record<EntityType, keyof Pick<ExtractionArtifactsResponse, 'characters' | 'locations' | 'items'>> = {
  character: 'characters',
  location: 'locations',
  item: 'items',
};

/** 按实体名（fallback 别名）匹配富产物。 */
export function matchArtifacts(
  data: ExtractionArtifactsResponse | undefined,
  type: EntityType,
  name: string,
  aliases: string[],
): EntityArtifacts | undefined {
  if (!data?.available) return undefined;
  const bucket = data[TYPE_BUCKET[type]];
  if (bucket[name]) return bucket[name];
  for (const alias of aliases) {
    if (bucket[alias]) return bucket[alias];
  }
  // 反向：产物条目的别名里含本实体名
  for (const entry of Object.values(bucket)) {
    const entryAliases = entry.description?.aliases ?? entry.visual?.aliases ?? [];
    if (entryAliases.includes(name)) return entry;
  }
  return undefined;
}
