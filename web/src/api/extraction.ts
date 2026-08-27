import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { apiFetch, openAuthenticatedSse } from './client';
import { booksKey } from './books';
import { entitiesKey } from './entities';
import type { ExtractionStagesResult, StageStatus, AgentType, ExtractionRunTasks, RunEstimate } from '@/types';

export const extractionKey = {
  stages: (bookId: string) => ['extraction', bookId, 'stages'] as const,
  estimate: (bookId: string) => ['extraction', bookId, 'estimate'] as const,
  currentRun: (bookId: string) => ['extraction', bookId, 'current-run'] as const,
};

export function useStages(bookId: string | undefined) {
  return useQuery({
    queryKey: bookId ? extractionKey.stages(bookId) : ['extraction', 'none'],
    queryFn: () => apiFetch<ExtractionStagesResult>(`/books/${bookId}/extract/stages`),
    enabled: !!bookId,
    refetchInterval: (q) => {
      const data = q.state.data;
      if (!data) return 5000;
      if (data.isComplete || data.isFailed) return false;
      // 只作为 SSE 的兜底，间隔较长
      return 10_000;
    },
  });
}

export function useStartExtraction(bookId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{ taskId: string; message: string }>(`/books/${bookId}/extract`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: booksKey.all });
      qc.invalidateQueries({ queryKey: extractionKey.stages(bookId) });
    },
  });
}

/** 启动前估算（实施包 D5）：字数/预计调用/队列前方/历史耗时/上限。 */
export function useRunEstimate(bookId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: bookId ? extractionKey.estimate(bookId) : ['extraction', 'none', 'estimate'],
    queryFn: () => apiFetch<{ estimate: RunEstimate }>(`/books/${bookId}/extraction-runs/estimate`).then((r) => r.estimate),
    enabled: !!bookId && enabled,
    staleTime: 30_000,
  });
}

/** 当前/最近运行（实施包 D1）。 */
export function useCurrentRun(bookId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: bookId ? extractionKey.currentRun(bookId) : ['extraction', 'none', 'current-run'],
    queryFn: () => apiFetch<ExtractionRunTasks>(`/books/${bookId}/extraction-runs/current`),
    enabled: !!bookId && enabled,
    refetchInterval: (q) => {
      const status = q.state.data?.run?.status;
      if (!status) return 10_000;
      if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(status)) return false;
      return 5_000;
    },
  });
}

/** 创建并启动一次提取运行（实施包 D1，新前端入口）。 */
export function useCreateRun(bookId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{ runId: string; taskId: string; message: string }>(`/books/${bookId}/extraction-runs`, {
        method: 'POST',
        body: {},
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: booksKey.all });
      qc.invalidateQueries({ queryKey: extractionKey.stages(bookId) });
      qc.invalidateQueries({ queryKey: extractionKey.currentRun(bookId) });
    },
  });
}

/** 运行控制：暂停 / 恢复 / 取消（实施包 D3）。 */
export function useRunAction(bookId: string, action: 'pause' | 'resume' | 'cancel') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) =>
      apiFetch<{ ok: boolean; message: string; resumedFrom?: string }>(
        `/books/${bookId}/extraction-runs/${runId}/${action}`,
        { method: 'POST', body: {} },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: extractionKey.stages(bookId) });
      qc.invalidateQueries({ queryKey: extractionKey.currentRun(bookId) });
    },
  });
}

/**
 * 断点续传：从第一个失败的 stage 继续（成功 stage 复用 result）。
 * 仅在 extraction 已失败（isFailed=true）时调用。
 */
export function useResumeExtraction(bookId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{ taskId: string; resumedFrom: string; message: string }>(
        `/books/${bookId}/extract/resume`,
        { method: 'POST' },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: booksKey.all });
      qc.invalidateQueries({ queryKey: extractionKey.stages(bookId) });
    },
  });
}

interface PipelineEvent {
  type: string;
  bookId?: string;
  agentType?: AgentType;
  taskId?: string;
  status?: StageStatus;
  message?: string;
  timestamp?: number;
}

function mergeEventIntoStages(
  prev: ExtractionStagesResult | undefined,
  event: PipelineEvent,
): ExtractionStagesResult | undefined {
  if (!prev) return prev;
  const stages = prev.stages.map((s) => {
    if (s.id !== event.agentType) return s;
    const next = { ...s };
    if (event.type === 'stage-started' || event.status === 'running') {
      next.status = 'running';
      next.startedAt = event.timestamp ? new Date(event.timestamp).toISOString() : new Date().toISOString();
    } else if (event.type === 'stage-completed' || event.status === 'completed') {
      next.status = 'completed';
      next.completedAt = event.timestamp ? new Date(event.timestamp).toISOString() : new Date().toISOString();
    } else if (event.type === 'stage-failed' || event.status === 'failed') {
      next.status = 'failed';
      next.message = event.message;
    }
    return next;
  });

  const overallProgress = stages.reduce((acc, s) => {
    if (s.status === 'completed') return acc + s.weight;
    if (s.status === 'running') return acc + s.weight * 0.5;
    return acc;
  }, 0);

  const reviewerDone = stages.find((s) => s.id === 'reviewer')?.status === 'completed';
  const anyFailed = stages.some((s) => s.status === 'failed');

  return {
    ...prev,
    stages,
    overallProgress: Math.round(reviewerDone ? 100 : overallProgress),
    isRunning: !reviewerDone && !anyFailed,
    isComplete: reviewerDone,
    isFailed: anyFailed && !reviewerDone,
  };
}

/** 将一条进度流消息写入缓存；完整快照到达终态时同步刷新书籍与实体。 */
export function applyExtractionStreamEvent(
  qc: QueryClient,
  bookId: string,
  raw: string,
  eventName?: string,
) {
  const data = JSON.parse(raw);
  const key = extractionKey.stages(bookId);
  if (!eventName && 'stages' in data) {
    const snapshot = data as ExtractionStagesResult;
    qc.setQueryData(key, snapshot);
    if (snapshot.isComplete || snapshot.isFailed) {
      qc.invalidateQueries({ queryKey: booksKey.all });
      qc.invalidateQueries({ queryKey: entitiesKey.all(bookId) });
    }
    return;
  }

  const evt: PipelineEvent = { type: eventName ?? data.type ?? 'unknown', ...data };
  qc.setQueryData<ExtractionStagesResult | undefined>(key, (prev) =>
    mergeEventIntoStages(prev, evt),
  );
  if (evt.type === 'completed') {
    qc.invalidateQueries({ queryKey: booksKey.all });
    qc.invalidateQueries({ queryKey: entitiesKey.all(bookId) });
  }
}

export function useExtractionStream(bookId: string | undefined, enabled: boolean) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!bookId || !enabled) return;

    const controller = new AbortController();
    const key = extractionKey.stages(bookId);

    const applyEvent = (raw: string, eventName?: string) => {
      try {
        applyExtractionStreamEvent(qc, bookId, raw, eventName);
      } catch (err) {
        console.warn('进度流解析失败：', err);
      }
    };

    void openAuthenticatedSse(`/books/${bookId}/extract/stream`, {
      signal: controller.signal,
      onEvent: ({ event, data }) => applyEvent(data, event === 'message' ? undefined : event),
    }).catch((error) => {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        qc.invalidateQueries({ queryKey: key });
      }
    });

    return () => {
      controller.abort();
    };
  }, [bookId, enabled, qc]);
}
