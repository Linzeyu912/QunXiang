import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';
import { storiesKey } from './stories';
import type {
  AssignmentWithStatus,
  CreateAssignmentBody,
  EpisodesResponse,
  PromptPackResponse,
  StoryboardPromptPack,
  VideoPromptPack,
} from '@/types/story';

export const directorKey = {
  assignments: (bookId: string) => ['director', bookId, 'assignments'] as const,
  episodes: (bookId: string, storyId: string) => ['director', bookId, 'episodes', storyId] as const,
  storyboard: (bookId: string, storyId: string, ep: number) =>
    ['director', bookId, 'storyboard', storyId, ep] as const,
  video: (bookId: string, storyId: string, ep: number) =>
    ['director', bookId, 'video', storyId, ep] as const,
};

export function useAssignments(bookId: string) {
  return useQuery({
    queryKey: directorKey.assignments(bookId),
    queryFn: () =>
      apiFetch<{ assignments: AssignmentWithStatus[] }>(`/books/${bookId}/director/assignments`),
    enabled: !!bookId,
  });
}

export function useCreateAssignment(bookId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateAssignmentBody) =>
      apiFetch<AssignmentWithStatus>(`/books/${bookId}/director/assignments`, {
        method: 'POST',
        body,
      }),
    onSuccess: (record) => {
      qc.invalidateQueries({ queryKey: directorKey.assignments(bookId) });
      qc.invalidateQueries({ queryKey: storiesKey.list(bookId) });
      for (const storyId of record.storyIds) {
        qc.invalidateQueries({ queryKey: directorKey.episodes(bookId, storyId) });
        // 分镜/视频包按 (storyId, ep) 缓存，直接按前缀失效
        qc.invalidateQueries({ queryKey: ['director', bookId, 'storyboard', storyId] });
        qc.invalidateQueries({ queryKey: ['director', bookId, 'video', storyId] });
      }
    },
  });
}

export function useEpisodes(bookId: string, storyId: string | undefined) {
  return useQuery({
    queryKey: directorKey.episodes(bookId, storyId ?? 'none'),
    queryFn: () => apiFetch<EpisodesResponse>(`/books/${bookId}/stories/${storyId}/episodes`),
    enabled: !!bookId && !!storyId,
  });
}

export function useStoryboard(bookId: string, storyId: string | undefined, episodeNo: number | null) {
  return useQuery({
    queryKey: directorKey.storyboard(bookId, storyId ?? 'none', episodeNo ?? -1),
    queryFn: () =>
      apiFetch<PromptPackResponse<StoryboardPromptPack>>(
        `/books/${bookId}/stories/${storyId}/episodes/${episodeNo}/storyboard`,
      ),
    enabled: !!bookId && !!storyId && episodeNo !== null,
  });
}

export function useVideoPrompts(
  bookId: string,
  storyId: string | undefined,
  episodeNo: number | null,
) {
  return useQuery({
    queryKey: directorKey.video(bookId, storyId ?? 'none', episodeNo ?? -1),
    queryFn: () =>
      apiFetch<PromptPackResponse<VideoPromptPack>>(
        `/books/${bookId}/stories/${storyId}/episodes/${episodeNo}/video-prompts`,
      ),
    enabled: !!bookId && !!storyId && episodeNo !== null,
  });
}
