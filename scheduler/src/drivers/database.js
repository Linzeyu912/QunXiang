import { TaskRepository } from '@novel-agent/storage';
/**
 * Database-backed TaskQueue implementation
 * Persists tasks to SQLite via Prisma
 */
export class DatabaseTaskQueue {
    async enqueue(task) {
        const created = await TaskRepository.create({
            bookId: task.bookId,
            agentType: task.agentType,
            payload: task.payload,
            status: task.status,
        });
        return created.id;
    }
    async dequeue(agentType) {
        // Get oldest pending task (FIFO)
        const pending = await TaskRepository.findPending(agentType);
        if (pending.length === 0) {
            return null;
        }
        const task = pending[0];
        // Mark as running
        await TaskRepository.updateStatus(task.id, 'running');
        task.status = 'running';
        return task;
    }
    async complete(taskId, result) {
        await TaskRepository.updateStatus(taskId, 'completed', result);
    }
    async fail(taskId, error) {
        await TaskRepository.updateStatus(taskId, 'failed', undefined, error);
    }
    async getStatus(taskId) {
        return TaskRepository.findById(taskId);
    }
    async getPending(agentType) {
        return TaskRepository.findAllPending(agentType);
    }
    async addToDeadLetter(taskId, error, retryCount) {
        await TaskRepository.markAsDeadLetter(taskId, error, retryCount);
    }
    async findStuckTasks(thresholdMs) {
        return TaskRepository.findStuckTasks(thresholdMs);
    }
    async recoverStuckTask(taskId) {
        await TaskRepository.recoverStuckTask(taskId);
    }
}
//# sourceMappingURL=database.js.map