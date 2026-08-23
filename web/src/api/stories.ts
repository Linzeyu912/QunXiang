import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, openAuthenticatedSse } from './client';
import type {
  AssetPatch,
  BoundaryDecision,
  BoundaryReviewItem,
  CharacterInStory,
  PropInStory,
  SceneInStory,
  StoriesListResponse,
  StoryAssetPack,
  StoryAssetPromptPack,
  StoryAssetType,
  StoryPipelineEvent,
  StorySegment,
  StorySummary,
} from '@/types/story';

export const storiesKey = {
  all: (bookId: string) => ['stories', bookId] as const,
  list: (bookId: string) => ['stories', bookId, 'list'] as const,
  detail: (bookId: string, storyId: string) => ['stories', bookId, 'detail', storyId] as const,
  boundaryReviews: (bookId: string) => ['stories', bookId, 'boundary-reviews'] as const,
  assets: (bookId: string, storyId: string) => ['stories', bookId, 'assets', storyId] as const,
  assetPrompts: (bookId: string, storyId: string) =>
    ['stories', bookId, 'asset-prompts', storyId] as const,
};

// ---------- 故事段 ----------

export function useStories(bookId: string | undefined) {
  return useQuery({
    queryKey: bookId ? storiesKey.list(bookId) : ['stories', 'none'],
    queryFn: () => apiFetch<StoriesListResponse>(`/books/${bookId}/stories`),
    enabled: !!bookId,
  });
}

export function useStoryDetail(bookId: string, storyId: string | undefined, includeSource = false) {
  return useQuery({
    queryKey: [...storiesKey.detail(bookId, storyId ?? 'none'), includeSource],
    queryFn: () =>
      apiFetch<StorySegment | Omit<StorySegment, 'sourceText'>>(
        `/books/${bookId}/stories/${storyId}${includeSource ? '?includeSource=true' : ''}`,
      ),
    enabled: !!bookId && !!storyId,
  });
}

export function useApproveStory(bookId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ storyId, approved }: { storyId: string; approved: boolean }) =>
      apiFetch<StorySummary>(`/books/${bookId}/stories/${storyId}/approve`, {
        method: 'POST',
        body: { approved },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: storiesKey.list(bookId) });
    },
  });
}

export function useApproveBatch(bookId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ storyIds, approved }: { storyIds: string[]; approved: boolean }) =>
      apiFetch<{ updated: string[]; skipped: { storyId: string; reason: string }[] }>(
        `/books/${bookId}/stories/approve-batch`,
        { method: 'POST', body: { storyIds, approved } },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: storiesKey.list(bookId) });
    },
  });
}

// ---------- 切分触发 + SSE 进度 ----------

export function useStartSegmentation(bookId: string) {
  return useMutation({
    mutationFn: () =>
      apiFetch<{ taskId: string; message: string }>(`/books/${bookId}/stories/segment`, {
        method: 'POST',
      }),
  });
}

export interface SegmentationProgress {
  active: boolean;
  stage?: string;
  message?: string;
  error?: string;
}

/**
 * 订阅切分 SSE：activeTaskId 非空时开流；done/error 后失效列表缓存并回调。
 * 兜底：SSE 断开且任务仍在时，回退到 5s 轮询 status。
 */
export function useSegmentationProgress(
  bookId: string,
  activeTaskId: string | null,
  onFinished: (ok: boolean, error?: string) => void,
): SegmentationProgress {
  const qc = useQueryClient();
  const [progress, setProgress] = useState<SegmentationProgress>({ active: false });
  const finishedRef = useRef(onFinished);
  finishedRef.current = onFinished;

  useEffect(() => {
    if (!activeTaskId) {
      setProgress({ active: false });
      return;
    }
    setProgress({ active: true, message: '正在启动…' });

    const controller = new AbortController();
    let closed = false;
    let pollTimer: ReturnType<typeof setInterval> | undefined;

    const clearPoll = () => {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = undefined;
      }
    };

    const finish = (ok: boolean, error?: string) => {
      clearPoll();
      qc.invalidateQueries({ queryKey: storiesKey.all(bookId) });
      setProgress({ active: false, error });
      finishedRef.current(ok, error);
    };

    const startPolling = () => {
      if (closed || pollTimer) return;
      // SSE 断开兜底：轮询任务状态。
      pollTimer = setInterval(async () => {
        try {
          const task = await apiFetch<{ status: string; message?: string; error?: string }>(
            `/books/${bookId}/stories/segment/status?taskId=${activeTaskId}`,
          );
          if (task.status === 'completed') {
            clearInterval(pollTimer);
            pollTimer = undefined;
            finish(true);
          } else if (task.status === 'failed') {
            clearInterval(pollTimer);
            pollTimer = undefined;
            finish(false, task.error);
          }
        } catch {
          // 保持轮询。
        }
      }, 5000);
    };

    const handle = (event: StoryPipelineEvent) => {
      if (event.type === 'stage-started' || event.type === 'stage-completed') {
        setProgress({ active: true, stage: event.stage, message: event.message });
      } else if (event.type === 'done') {
        closed = true;
        controller.abort();
        finish(true);
      } else if (event.type === 'error') {
        closed = true;
        controller.abort();
        finish(false, event.message);
      }
    };

    const parse = (raw: string): StoryPipelineEvent | null => {
      try {
        return JSON.parse(raw) as StoryPipelineEvent;
      } catch (err) {
        console.warn('进度流解析失败：', err);
        return null;
      }
    };

    void openAuthenticatedSse(`/books/${bookId}/stories/segment/stream`, {
      signal: controller.signal,
      onEvent: ({ event, data }) => {
        const evt = parse(data);
        if (evt && !evt.type) evt.type = event as StoryPipelineEvent['type'];
        if (evt) handle(evt);
      },
    }).then(startPolling).catch((error) => {
      if (!(error instanceof DOMException && error.name === 'AbortError')) startPolling();
    });

    return () => {
      closed = true;
      controller.abort();
      clearPoll();
    };
  }, [bookId, activeTaskId, qc]);

  return progress;
}

// ---------- 边界审核 ----------

export function useBoundaryReviews(bookId: string) {
  return useQuery({
    queryKey: storiesKey.boundaryReviews(bookId),
    queryFn: () =>
      apiFetch<{ items: BoundaryReviewItem[] }>(
        `/books/${bookId}/stories/boundary-reviews?status=pending`,
      ),
    enabled: !!bookId,
  });
}

export function useResolveBoundary(bookId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ reviewId, decision }: { reviewId: string; decision: BoundaryDecision }) =>
      apiFetch<{ item: BoundaryReviewItem; merged: boolean; pendingCount: number }>(
        `/books/${bookId}/stories/boundary-reviews/${reviewId}/resolve`,
        { method: 'POST', body: { decision } },
      ),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: storiesKey.boundaryReviews(bookId) });
      qc.invalidateQueries({ queryKey: storiesKey.list(bookId) });
      if (res.merged) {
        // 合并会改写故事段与资产，整棵失效
        qc.invalidateQueries({ queryKey: storiesKey.all(bookId) });
      }
    },
  });
}

// ---------- 故事资产 ----------

export function useAssetPack(bookId: string, storyId: string | undefined) {
  return useQuery({
    queryKey: storiesKey.assets(bookId, storyId ?? 'none'),
    queryFn: () => apiFetch<StoryAssetPack>(`/books/${bookId}/stories/${storyId}/assets`),
    enabled: !!bookId && !!storyId,
    retry: (failureCount, error) =>
      // 404 = 资产尚未提取，不重试
      !(error instanceof Error && error.message.includes('尚未提取')) && failureCount < 2,
  });
}

export function useAssetPrompts(bookId: string, storyId: string | undefined) {
  return useQuery({
    queryKey: storiesKey.assetPrompts(bookId, storyId ?? 'none'),
    queryFn: () =>
      apiFetch<StoryAssetPromptPack>(`/books/${bookId}/stories/${storyId}/asset-prompts`),
    enabled: !!bookId && !!storyId,
    retry: false,
  });
}

export function useExtractAssets(bookId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (storyId: string) =>
      apiFetch<StoryAssetPack>(`/books/${bookId}/stories/${storyId}/assets/extract`, {
        method: 'POST',
      }),
    onSuccess: (pack, storyId) => {
      qc.setQueryData(storiesKey.assets(bookId, storyId), pack);
      qc.invalidateQueries({ queryKey: storiesKey.assetPrompts(bookId, storyId) });
      qc.invalidateQueries({ queryKey: storiesKey.list(bookId) });
    },
  });
}

export function usePatchAsset(bookId: string, storyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      assetType,
      assetName,
      patch,
    }: {
      assetType: StoryAssetType;
      assetName: string;
      patch: AssetPatch;
    }) =>
      apiFetch<CharacterInStory | SceneInStory | PropInStory>(
        `/books/${bookId}/stories/${storyId}/assets/${assetType}/${encodeURIComponent(assetName)}`,
        { method: 'PATCH', body: patch },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: storiesKey.assets(bookId, storyId) });
      qc.invalidateQueries({ queryKey: storiesKey.assetPrompts(bookId, storyId) });
    },
  });
}
