import { afterEach, describe, expect, it, vi } from 'vitest';
import { TaskDispatcher } from './dispatcher.js';
import type { TaskQueue } from './task-queue.js';

function createQueue(): TaskQueue {
  return {
    enqueue: async () => 'task-1',
    dequeue: async () => null,
    complete: async () => undefined,
    fail: async () => undefined,
    heartbeat: async () => undefined,
    getStatus: async () => null,
    getPending: async () => [],
    addToDeadLetter: async () => undefined,
    findStuckTasks: async () => [],
    recoverStuckTask: async () => undefined,
  };
}

describe('提取工作进程池', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('按指定数量并行轮询，并在空闲时逐步退避', async () => {
    vi.useFakeTimers();
    const dispatcher = new TaskDispatcher(createQueue());
    const processNext = vi.spyOn(dispatcher, 'processNext').mockResolvedValue(undefined);

    dispatcher.startWorkers(3, 1000);
    expect(dispatcher.getWorkerCount()).toBe(3);

    await vi.advanceTimersByTimeAsync(1000);
    expect(processNext).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1000);
    expect(processNext).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1000);
    expect(processNext).toHaveBeenCalledTimes(6);

    dispatcher.stopWorkers();
    expect(dispatcher.getWorkerCount()).toBe(0);
  });

  it('每次领取任务前执行配置刷新钩子', async () => {
    vi.useFakeTimers();
    const dispatcher = new TaskDispatcher(createQueue());
    vi.spyOn(dispatcher, 'processNext').mockResolvedValue('task-1');
    const refresh = vi.fn();

    dispatcher.startWorkers(2, 1000, refresh);
    await vi.advanceTimersByTimeAsync(1000);
    dispatcher.stopWorkers();

    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
