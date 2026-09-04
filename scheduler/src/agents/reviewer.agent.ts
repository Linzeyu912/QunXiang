import type { AgentType } from '@qunxiang/core';

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
  // payload 携带整包实体结果（可达 MB 级）：同步 JSON.stringify 会阻塞事件循环，
  // 挤慢同进程的实体/产物接口，只留定位信息（与 dispatcher 的任务日志一致）。
  const { characters, bookId } = payload as ReviewerPayload;
  console.log(`[ReviewerAgent] 收到审核入库任务：书籍 ${bookId}，候选角色 ${Array.isArray(characters) ? characters.length : 0} 个`);

  // This is the human review step - characters are already stored in DB
  // with status PENDING, waiting for UI review
  return {
    message: 'Characters ready for human review',
    count: characters.length,
  };
}
