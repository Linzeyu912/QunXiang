import { getNextAgent } from './pipeline.js';
import { executeExtractor, executeValidator, executeResolution, executeDescriptionFusion, executeVisualDescription, executeReviewer, } from './agents/index.js';
import { CharacterRepository } from '@novel-agent/storage';
const DEFAULT_RETRY_CONFIG = {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
};
async function withRetry(fn, config = DEFAULT_RETRY_CONFIG) {
    let attempts = 0;
    let lastError;
    while (attempts <= config.maxRetries) {
        attempts++;
        try {
            const result = await fn();
            return { result, attempts };
        }
        catch (error) {
            lastError = error;
            if (attempts <= config.maxRetries) {
                const delay = Math.min(config.baseDelayMs * Math.pow(2, attempts - 1), config.maxDelayMs);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    return {
        error: lastError instanceof Error ? lastError.message : String(lastError),
        attempts,
    };
}
export class TaskDispatcher {
    constructor(queue) {
        this.queue = queue;
        this.agents = new Map([
            ['extractor', executeExtractor],
            ['validator', executeValidator],
            ['entity-resolution', executeResolution],
            ['description-fusion', executeDescriptionFusion],
            ['visual-description', executeVisualDescription],
            ['reviewer', executeReviewer],
        ]);
    }
    async startExtraction(bookId, userId) {
        // Enqueue first task in pipeline
        const taskId = await this.queue.enqueue({
            bookId,
            agentType: 'extractor',
            payload: { bookId, userId },
            status: 'pending',
        });
        // Start processing
        this.processNext('extractor');
        return taskId;
    }
    async processNext(agentType) {
        const task = await this.queue.dequeue(agentType);
        if (!task)
            return;
        const agent = this.agents.get(agentType);
        if (!agent) {
            await this.queue.fail(task.id, `Unknown agent type: ${agentType}`);
            return;
        }
        try {
            const { result, error, attempts } = await withRetry(() => agent(task.payload));
            if (error) {
                if (attempts > DEFAULT_RETRY_CONFIG.maxRetries) {
                    await this.queue.addToDeadLetter(task.id, error, attempts);
                }
                else {
                    await this.queue.fail(task.id, error);
                }
                return;
            }
            await this.queue.complete(task.id, result);
            // Save characters to database before reviewer stage
            const nextAgent = getNextAgent(agentType);
            if (nextAgent === 'reviewer' && result && typeof result === 'object' && 'characters' in result) {
                const chars = result.characters;
                if (chars.length > 0) {
                    // Use payload.bookId which carries the correct bookId from the original extraction request,
                    // not task.bookId which could be stale from a previous pending task
                    const bookId = task.payload.bookId || task.bookId;
                    await CharacterRepository.createMany(chars.map((c) => ({
                        bookId,
                        name: c.name,
                        aliases: Array.isArray(c.aliases) ? c.aliases : [],
                        description: c.description || null,
                        confidence: c.confidence || 0.5,
                        status: 'PENDING',
                        chapterRef: c.chapterRef || null,
                    })));
                }
            }
            if (nextAgent) {
                await this.queue.enqueue({
                    bookId: task.bookId,
                    agentType: nextAgent,
                    payload: { ...result, bookId: task.bookId, userId: task.payload.userId },
                    status: 'pending',
                });
                this.processNext(nextAgent);
            }
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            await this.queue.fail(task.id, errorMessage);
        }
    }
    async getTaskStatus(taskId) {
        return this.queue.getStatus(taskId);
    }
}
//# sourceMappingURL=dispatcher.js.map
