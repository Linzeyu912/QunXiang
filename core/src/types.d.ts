export interface Book {
    id: string;
    title: string;
    content: string;
    status: 'UPLOADED' | 'EXTRACTING' | 'EXTRACTED';
    userId: string;
    createdAt: Date;
    updatedAt?: Date;
}
export interface Character {
    id: string;
    bookId: string;
    name: string;
    aliases: string[];
    description?: string;
    confidence: number;
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
    chapterRef?: string;
    createdAt: Date;
    updatedAt?: Date;
}
export interface User {
    id: string;
    email: string;
    name: string;
    createdAt: Date;
}
export interface CharacterReview {
    id: string;
    characterId: string;
    userId: string;
    action: 'APPROVED' | 'REJECTED' | 'EDITED';
    previousValue?: string;
    newValue?: string;
    createdAt: Date;
}
export interface ExtractionSession {
    id: string;
    bookId: string;
    userId: string;
    status: 'RUNNING' | 'COMPLETED' | 'FAILED';
    createdAt: Date;
    completedAt?: Date;
}
export type AgentType = 'extractor' | 'validator' | 'entity-resolution' | 'description-fusion' | 'visual-description' | 'reviewer';
export interface Task {
    id: string;
    bookId: string;
    agentType: AgentType;
    payload: unknown;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'dead_lettered';
    result?: unknown;
    error?: string;
    retryCount?: number;
    deadLettered?: boolean;
    failedAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}
export interface PipelineConfig {
    agents: AgentType[];
    maxRetries?: number;
    timeout?: number;
}
//# sourceMappingURL=types.d.ts.map
