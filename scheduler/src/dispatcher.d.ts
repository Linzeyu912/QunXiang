import type { AgentType, Task } from '@novel-agent/core';
import type { TaskQueue } from './task-queue.js';
export declare class TaskDispatcher {
    private queue;
    private agents;
    private isProcessing;
    private workerTimer;
    private static readonly STAGE_NAMES;
    constructor(queue: TaskQueue);
    startExtraction(bookId: string, userId: string): Promise<{
        extractorTaskId: string;
    }>;
    startWorker(intervalMs?: number): void;
    stopWorker(): void;
    processNext(agentType: AgentType): Promise<string | undefined>;
    private finalizePipeline;
    getTaskStatus(taskId: string): Promise<Task | null>;
}
//# sourceMappingURL=dispatcher.d.ts.map
