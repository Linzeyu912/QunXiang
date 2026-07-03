import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';
import { booksKey } from './books';
import { entitiesKey } from './entities';
import { getToken } from '@/store/authStore';
import type { ExtractionStagesResult, StageStatus, AgentType } from '@/types';

export const extractionKey = {
  stages: (bookId: string) => ['extraction', bookId, 'stages'] as const,
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

export function useExtractionStream(bookId: string | undefined, enabled: boolean) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!bookId || !enabled) return;

    // EventSource 不能设置请求头，token 走 query param（后端 onRequest 钩子兜底读取）。
    const token = getToken();
    const url = `/books/${bookId}/extract/stream${token ? `?access_token=${encodeURIComponent(token)}` : ''}`;
    const es = new EventSource(url);
    const key = extractionKey.stages(bookId);

    const applyEvent = (raw: MessageEvent, eventName?: string) => {
      try {
        const data = JSON.parse(raw.data);
        // 首帧（无 event 名，纯 data:）是完整快照
        if (!eventName && 'stages' in data) {
          qc.setQueryData(key, data as ExtractionStagesResult);
          return;
        }
        // 增量事件：合并
        const evt: PipelineEvent = { type: eventName ?? data.type ?? 'unknown', ...data };
        qc.setQueryData<ExtractionStagesResult | undefined>(key, (prev) =>
          mergeEventIntoStages(prev, evt),
        );

        if (evt.type === 'completed' || evt.type === 'stage-completed') {
          if (evt.type === 'completed') {
            qc.invalidateQueries({ queryKey: booksKey.all });
            qc.invalidateQueries({ queryKey: entitiesKey.all(bookId) });
          }
        }
      } catch (err) {
        console.warn('[SSE] parse error', err);
      }
    };

    es.onmessage = (e) => applyEvent(e);
    const namedEvents = ['stage-started', 'stage-completed', 'stage-failed', 'completed', 'error'];
    const handlers = namedEvents.map((name) => {
      const h = (e: MessageEvent) => applyEvent(e, name);
      es.addEventListener(name, h as EventListener);
      return { name, h };
    });
    es.onerror = () => {
      // 让 EventSource 自动重连；重连回来时主动拉一次快照做对齐
      qc.invalidateQueries({ queryKey: key });
    };

    return () => {
      handlers.forEach(({ name, h }) => es.removeEventListener(name, h as EventListener));
      es.close();
    };
  }, [bookId, enabled, qc]);
}
