export class InMemoryTaskQueue {
    constructor() {
        this.tasks = new Map();
        this.pendingByAgent = new Map();
    }
    async enqueue(task) {
        const id = crypto.randomUUID();
        const now = new Date();
        const fullTask = {
            ...task,
            id,
            createdAt: now,
            updatedAt: now,
        };
        this.tasks.set(id, fullTask);
        const pending = this.pendingByAgent.get(task.agentType) || [];
        pending.push(id);
        this.pendingByAgent.set(task.agentType, pending);
        return id;
    }
    async dequeue(agentType) {
        const pending = this.pendingByAgent.get(agentType) || [];
        if (pending.length === 0)
            return null;
        const taskId = pending.shift();
        const task = this.tasks.get(taskId);
        if (!task)
            return null;
        task.status = 'running';
        task.updatedAt = new Date();
        this.tasks.set(taskId, task);
        return task;
    }
    async complete(taskId, result) {
        const task = this.tasks.get(taskId);
        if (!task)
            return;
        task.status = 'completed';
        task.result = result;
        task.updatedAt = new Date();
        this.tasks.set(taskId, task);
        // Remove from pending
        const pending = this.pendingByAgent.get(task.agentType) || [];
        const index = pending.indexOf(taskId);
        if (index > -1)
            pending.splice(index, 1);
    }
    async fail(taskId, error) {
        const task = this.tasks.get(taskId);
        if (!task)
            return;
        task.status = 'failed';
        task.error = error;
        task.updatedAt = new Date();
        this.tasks.set(taskId, task);
        // Remove from pending
        const pending = this.pendingByAgent.get(task.agentType) || [];
        const index = pending.indexOf(taskId);
        if (index > -1)
            pending.splice(index, 1);
    }
    async getStatus(taskId) {
        return this.tasks.get(taskId) || null;
    }
    async getPending(agentType) {
        const pending = this.pendingByAgent.get(agentType) || [];
        return pending
            .map(id => this.tasks.get(id))
            .filter((t) => t !== undefined && t.status === 'pending');
    }
    async addToDeadLetter(taskId, error, retryCount) {
        const task = this.tasks.get(taskId);
        if (!task)
            return;
        task.status = 'dead_lettered';
        task.error = error;
        task.retryCount = retryCount;
        task.deadLettered = true;
        task.failedAt = new Date();
        task.updatedAt = new Date();
        this.tasks.set(taskId, task);
        // Remove from pending
        const pending = this.pendingByAgent.get(task.agentType) || [];
        const index = pending.indexOf(taskId);
        if (index > -1)
            pending.splice(index, 1);
    }
    async findStuckTasks(thresholdMs) {
        const cutoff = new Date(Date.now() - thresholdMs);
        const stuck = [];
        for (const task of this.tasks.values()) {
            if (task.status === 'running' && task.updatedAt < cutoff) {
                stuck.push(task);
            }
        }
        return stuck;
    }
    async recoverStuckTask(taskId) {
        const task = this.tasks.get(taskId);
        if (!task)
            return;
        task.status = 'pending';
        task.error = undefined;
        task.deadLettered = false;
        task.failedAt = undefined;
        task.updatedAt = new Date();
        this.tasks.set(taskId, task);
        // Re-add to pending queue
        const pending = this.pendingByAgent.get(task.agentType) || [];
        if (!pending.includes(taskId)) {
            pending.unshift(taskId);
            this.pendingByAgent.set(task.agentType, pending);
        }
    }
}
//# sourceMappingURL=in-memory.js.map