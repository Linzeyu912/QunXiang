import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../api/client';

/** Pipeline event types received via SSE */
interface SSEPipelineEvent {
  type: 'stage_start' | 'stage_complete' | 'completed' | 'error';
  bookId: string;
  stageId?: string;
  stageName?: string;
  progress?: number;
  message?: string;
  timestamp: number;
}

/** Initial snapshot sent as first SSE data event (from getExtractionStages) */
interface ExtractionSnapshot {
  bookId: string;
  overallProgress: number;
  isRunning: boolean;
  isComplete: boolean;
  isFailed: boolean;
  stages: ExtractionStage[];
}

export interface ExtractionStage {
  id: string;
  name: string;
  weight: number;
  status: string;
  startedAt?: string;
  completedAt?: string;
  message?: string;
}

export interface ExtractionProgress {
  bookId: string;
  overallProgress: number;
  isRunning: boolean;
  isComplete: boolean;
  isFailed: boolean;
  stages: ExtractionStage[];
}

const POLL_INTERVAL = 2000; // fallback poll interval
const MAX_RECONNECT_ATTEMPTS = 3;

function parseSSE(text: string): Array<{ event?: string; data: string }> {
  const messages: Array<{ event?: string; data: string }> = [];
  let currentEvent: string | undefined;
  let currentData = '';

  for (const line of text.split('\n')) {
    if (line.startsWith('event:')) {
      currentEvent = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      currentData += line.slice(5).trim() + '\n';
    } else if (line === '') {
      // Empty line = end of message
      if (currentData) {
        messages.push({ event: currentEvent, data: currentData.trim() });
        currentEvent = undefined;
        currentData = '';
      }
    }
  }

  // Handle last message without trailing newline
  if (currentData) {
    messages.push({ event: currentEvent, data: currentData.trim() });
  }

  return messages;
}

export function useExtractionProgress(bookId: string | null) {
  const [progress, setProgress] = useState<ExtractionProgress | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stream state
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const abortRef = useRef(false);
  const reconnectCountRef = useRef(0);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cleanup = useCallback(() => {
    abortRef.current = true;
    if (readerRef.current) {
      readerRef.current.cancel().catch(() => {});
      readerRef.current = null;
    }
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  /** Fallback to HTTP polling when SSE is unavailable */
  const startFallbackPolling = useCallback((id: string) => {
    if (pollTimerRef.current) return;
    setLoading(true);
    setError(null);

    const fetchOnce = async () => {
      try {
        const result = await api.getExtractionStages(id);
        setProgress(result);
        setError(null);
        if (result.isComplete || result.isFailed) {
          cleanup();
        }
      } catch (err: any) {
        console.error('[SSE Fallback] Poll failed:', err);
        setError(err?.message || '获取进度失败');
      }
    };

    fetchOnce();
    pollTimerRef.current = setInterval(fetchOnce, POLL_INTERVAL);
  }, [cleanup]);

  /** Main SSE stream connection */
  const startStream = useCallback(async (id: string) => {
    cleanup();
    abortRef.current = false;

    try {
      setLoading(true);
      setError(null);
      reconnectCountRef.current = 0;

      const reader = await api.getExtractionStream(id);
      readerRef.current = reader;
      const decoder = new TextDecoder();
      let buffer = '';

      while (!abortRef.current) {
        const { done, value } = await reader.read();

        if (done) {
          console.log('[SSE] Stream closed by server');
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        // Parse all complete messages from buffer
        const newlineIdx = buffer.lastIndexOf('\n\n');
        if (newlineIdx === -1) continue; // Wait for more data

        const chunk = buffer.slice(0, newlineIdx + 2);
        buffer = buffer.slice(newlineIdx + 2);

        const messages = parseSSE(chunk);

        for (const msg of messages) {
          // Skip heartbeat
          if (!msg.data || msg.data === '{}') continue;

            try {
              const parsed = JSON.parse(msg.data) as SSEPipelineEvent | ExtractionSnapshot;

            if ('overallProgress' in parsed && 'stages' in parsed) {
              // Initial full snapshot (from getExtractionStages)
              setProgress(parsed);
              if (parsed.isComplete || parsed.isFailed) {
                return; // Already done
              }
              continue;
            }

            // Pipeline events — update progress from stage events
            setProgress((prev) => {
              if (!prev) return prev;
              const stages = [...prev.stages];

              const eventType = msg.event || ('type' in parsed ? (parsed as SSEPipelineEvent).type : undefined);

              switch (eventType) {
                case 'stage_start': {
                  const idx = stages.findIndex((s) => s.id === parsed.stageId);
                  if (idx >= 0) {
                    stages[idx] = {
                      ...stages[idx],
                      status: 'running',
                      startedAt: new Date(parsed.timestamp).toISOString(),
                    };
                  }
                  return { ...prev, stages, isRunning: true };
                }
                case 'stage_complete': {
                  const idx = stages.findIndex((s) => s.id === parsed.stageId);
                  if (idx >= 0) {
                    stages[idx] = {
                      ...stages[idx],
                      status: 'completed',
                      completedAt: new Date(parsed.timestamp).toISOString(),
                    };
                  }
                  return {
                    ...prev,
                    overallProgress: parsed.progress ?? prev.overallProgress,
                    stages,
                    isRunning: !(parsed.type === 'completed'),
                  };
                }
                case 'completed':
                  return {
                    ...prev,
                    overallProgress: 100,
                    isRunning: false,
                    isComplete: true,
                    isFailed: false,
                    stages: stages.map((s) =>
                      s.status !== 'failed'
                        ? { ...s, status: s.status === 'running' ? 'completed' : s.status }
                        : s
                    ),
                  };
                case 'error': {
                  const idx = stages.findIndex((s) => s.id === parsed.stageId);
                  if (idx >= 0) {
                    stages[idx] = { ...stages[idx], status: 'failed', message: parsed.message };
                  }
                  return {
                    ...prev,
                    stages,
                    isRunning: false,
                    isComplete: false,
                    isFailed: true,
                  };
                }
                default:
                  return prev;
              }
            });

            // Stop on terminal events
            if (eventType === 'completed' || eventType === 'error') {
              return;
            }
          } catch {
            // Non-JSON data (e.g., heartbeat comment), skip
          }
        }
      }
    } catch (err: any) {
      console.error('[SSE] Stream error:', err);
      reconnectCountRef.current++;

      if (reconnectCountRef.current <= MAX_RECONNECT_ATTEMPTS) {
        console.log(`[SSE] Reconnecting (${reconnectCountRef.current}/${MAX_RECONNECT_ATTEMPTS})...`);
        // Small delay before reconnect
        await new Promise((r) => setTimeout(r, 1000));
        if (!abortRef.current && bookId) {
          startStream(bookId);
        }
      } else {
        console.warn('[SSE] Max reconnect attempts reached, falling back to polling');
        setError(err?.message || 'SSE 连接失败，已切换为轮询模式');
        if (bookId) {
          startFallbackPolling(bookId);
        }
      }
    }
  }, [bookId, cleanup, startFallbackPolling]);

  const startPolling = useCallback(() => {
    if (!bookId) return;
    startStream(bookId);
  }, [bookId, startStream]);

  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  return {
    progress,
    loading,
    error,
    startPolling,
    stopPolling: cleanup,
    refresh: async () => {
      if (bookId) {
        try {
          const result = await api.getExtractionStages(bookId);
          setProgress(result);
        } catch {}
      }
    },
  };
}
