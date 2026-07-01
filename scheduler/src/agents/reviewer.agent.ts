import type { AgentType } from '@novel-agent/core';

export const reviewerAgentType: AgentType = 'reviewer';

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

export async function executeReviewer(payload: unknown): Promise<ReviewerResult> {
  console.log('[ReviewerAgent] Received payload:', JSON.stringify(payload));
  const { characters, bookId } = payload as ReviewerPayload;
  console.log('[ReviewerAgent] bookId:', bookId);

  // This is the human review step - characters are already stored in DB
  // with status PENDING, waiting for UI review
  return {
    message: 'Characters ready for human review',
    count: characters.length,
  };
}
