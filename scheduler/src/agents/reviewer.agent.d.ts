import type { AgentType } from '@novel-agent/core';
export declare const reviewerAgentType: AgentType;
export interface ReviewerPayload {
    characters: Array<{
        name: string;
        aliases: string[];
        description?: string;
        confidence: number;
        status: string;
        chapterRef?: string;
    }>;
    bookId: string;
}
export interface ReviewerResult {
    message: string;
    count: number;
}
export declare function executeReviewer(payload: unknown): Promise<ReviewerResult>;
//# sourceMappingURL=reviewer.agent.d.ts.map