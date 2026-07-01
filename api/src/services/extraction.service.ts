import { BookRepository, UserRepository, TaskRepository } from '@novel-agent/storage';
import { TaskDispatcher, DatabaseTaskQueue, eventBus } from '@novel-agent/scheduler';
import type { PipelineEvent } from '@novel-agent/scheduler';
import { CharacterRepository } from '@novel-agent/storage';
import { getDefaultProvider } from '@novel-agent/llm';
import type { AgentType } from '@novel-agent/core';

const taskQueue = new DatabaseTaskQueue();
const dispatcher = new TaskDispatcher(taskQueue);

// Start background worker to process extraction pipelines asynchronously
dispatcher.startWorker(1000);

const PIPELINE_STAGES: { id: AgentType; name: string; weight: number }[] = [
  { id: 'extractor', name: '角色提取', weight: 30 },
  { id: 'validator', name: '置信度校验', weight: 12 },
  { id: 'entity-resolution', name: '实体消解', weight: 18 },
  { id: 'description-fusion', name: '简介融合', weight: 15 },
  { id: 'visual-description', name: '视觉描述补全', weight: 15 },
  { id: 'reviewer', name: '审核入库', weight: 10 },
];

export async function startExtraction(bookId: string, userId: string) {
  try {
    // Ensure user exists
    await UserRepository.findOrCreate({ email: `${userId}@example.com`, name: userId });

    // Update book status
    await BookRepository.updateStatus(bookId, 'EXTRACTING');

    // Validate provider is available (will throw if not configured)
    const provider = await getDefaultProvider();

    // Enqueue extraction task; actual processing happens in the background worker
    const { extractorTaskId } = await dispatcher.startExtraction(bookId, userId);

    return { taskId: extractorTaskId, provider: provider.name };
  } catch (err) {
    await BookRepository.updateStatus(bookId, 'FAILED');
    throw err;
  }
}

export async function pollExtractionStatus(taskId: string) {
  const task = await dispatcher.getTaskStatus(taskId);
  if (!task) {
    return { status: 'not_found' };
  }

  const bookId = task.bookId;

  // If extraction failed, update book status
  if (task.status === 'failed') {
    await BookRepository.updateStatus(bookId, 'FAILED');
    return { status: 'failed', task };
  }

  // If extraction is complete (passed through all pipeline stages), fetch characters
  if (task.agentType === 'reviewer' && task.status === 'completed') {
    const characters = await CharacterRepository.findByBookId(bookId);

    // Update book status
    await BookRepository.updateStatus(bookId, 'EXTRACTED');

    return { status: 'completed', task, characters };
  }

  return { status: task.status, task };
}

export interface ExtractionStageInfo {
  id: string;
  name: string;
  weight: number;
  status: string;
  startedAt?: string;
  completedAt?: string;
  message?: string;
}

export interface ExtractionStagesResult {
  bookId: string;
  overallProgress: number;
  isRunning: boolean;
  isComplete: boolean;
  isFailed: boolean;
  stages: ExtractionStageInfo[];
}

export async function getExtractionStages(bookId: string): Promise<ExtractionStagesResult> {
  const tasks = await TaskRepository.findByBookId(bookId);

  let overallProgress = 0;
  let isRunning = false;
  let isComplete = false;
  let isFailed = false;

  const stages: ExtractionStageInfo[] = PIPELINE_STAGES.map((stage) => {
    const task = tasks.find((t) => t.agentType === stage.id);
    const status = task ? task.status : 'pending';

    if (status === 'completed') {
      overallProgress += stage.weight;
    } else if (status === 'running') {
      overallProgress += stage.weight * 0.5;
      isRunning = true;
    } else if (status === 'failed') {
      isFailed = true;
    }

    return {
      id: stage.id,
      name: stage.name,
      weight: stage.weight,
      status,
      startedAt: task?.createdAt ? task.createdAt.toISOString() : undefined,
      completedAt: task?.updatedAt ? task.updatedAt.toISOString() : undefined,
      message: task?.error || undefined,
    };
  });

  const reviewerStage = stages.find((s) => s.id === 'reviewer');
  if (reviewerStage?.status === 'completed') {
    isComplete = true;
    overallProgress = 100;
  }

  return {
    bookId,
    overallProgress: Math.round(overallProgress),
    isRunning: isRunning || (!isComplete && !isFailed),
    isComplete,
    isFailed,
    stages,
  };
}

/**
 * Create an SSE stream for real-time extraction progress.
 * Returns an async generator that yields SSE-formatted strings.
 */
export async function* createExtractionStream(
  bookId: string
): AsyncGenerator<string> {
  // Send initial state (full stages snapshot)
  const initialState = await getExtractionStages(bookId);
  yield `data: ${JSON.stringify(initialState)}\n\n`;

  // If already complete or failed, close immediately
  if (initialState.isComplete || initialState.isFailed) {
    return;
  }

  // Subscribe to pipeline events for this bookId using a promise queue pattern
  const eventQueue: PipelineEvent[] = [];
  let resolveWaiter: (() => void) | null = null;

  const unsub = eventBus.on.bind(eventBus, bookId, (event) => {
    eventQueue.push(event);
    if (resolveWaiter) {
      resolveWaiter();
      resolveWaiter = null;
    }
  });

  try {
    while (true) {
      // Wait for next event or heartbeat timeout
      const result = await new Promise<PipelineEvent | 'heartbeat'>((resolve) => {
        // Drain any queued events immediately
        if (eventQueue.length > 0) {
          resolve(eventQueue.shift()!);
          return;
        }
        // Otherwise wait for new event or heartbeat
        resolveWaiter = () => {
          if (eventQueue.length > 0) {
            resolve(eventQueue.shift()!);
          } else {
            // Event was consumed by another check; re-wait will happen next loop iteration
            // This shouldn't happen normally but handle gracefully
            resolve('heartbeat');
          }
        };
        setTimeout(() => {
          if (resolveWaiter) {
            resolveWaiter = null;
            resolve('heartbeat');
          }
        }, 15000);
      });

      if (result === 'heartbeat') {
        yield ': heartbeat\n\n';
      } else {
        const sseEvent = `event: ${result.type}\ndata: ${JSON.stringify(result)}\n\n`;
        yield sseEvent;

        // Stop on terminal events
        if (result.type === 'completed' || result.type === 'error') {
          return;
        }
      }
    }
  } finally {
    eventBus.removeAllListeners(`pipeline:${bookId}`);
  }
}
