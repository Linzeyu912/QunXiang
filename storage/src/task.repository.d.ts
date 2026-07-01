import type { Task, AgentType } from '@novel-agent/core';
export declare const TaskRepository: {
    create(data: {
        bookId: string;
        agentType: AgentType;
        payload: unknown;
        status?: string;
    }): Promise<Task>;
    findById(id: string): Promise<Task | null>;
    updateStatus(id: string, status: string, result?: unknown, error?: string): Promise<Task>;
    findPending(agentType: AgentType): Promise<Task[]>;
    findByBookId(bookId: string): Promise<Task[]>;
    findAllPending(agentType: AgentType): Promise<Task[]>;
    markAsDeadLetter(taskId: string, error: string, retryCount: number): Promise<Task>;
    findStuckTasks(thresholdMs: number): Promise<Task[]>;
    recoverStuckTask(taskId: string): Promise<Task>;
    incrementRetryCount(taskId: string): Promise<Task>;
};
//# sourceMappingURL=task.repository.d.ts.map