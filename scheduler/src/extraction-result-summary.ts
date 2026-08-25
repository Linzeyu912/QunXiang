/**
 * 从管道终段（reviewer 之前的入库段）的 result 中解包三类实体并统计总数。
 * 独立成文件（而非放在 dispatcher.ts 内）是为了便于单元测试——避免引入
 * dispatcher.ts 重依赖图（agents/llm）导致测试加载困难。
 *
 * 空结果判定（"管道跑完但三类实体全空"）是历史 bug 的核心防护点：
 * 此前空结果被静默标成 completed，前端显示"已完成"而角色/场景页面为空。
 * 现在 totalCount === 0 即表示本轮无产出，调用方应判管道失败而非完成。
 */
export interface ExtractionResultSummary {
  characters: any[];
  locations: any[];
  items: any[];
  /** 世界观/体系设定；不计入 totalCount 空结果守卫（仅有世界观不算有效产出）。 */
  worldviews: any[];
  totalCount: number;
}

export function summarizeExtractionResult(result: unknown): ExtractionResultSummary {
  const r = (result && typeof result === 'object' ? result : {}) as Record<string, unknown>;
  const characters = Array.isArray(r.characters) ? r.characters : [];
  const locations = Array.isArray(r.locations) ? r.locations : [];
  const items = Array.isArray(r.items) ? r.items : [];
  const worldviews = Array.isArray(r.worldviews) ? r.worldviews : [];
  return {
    characters,
    locations,
    items,
    worldviews,
    totalCount: characters.length + locations.length + items.length,
  };
}

/** 空结果（三类实体全无）时的失败原因，供 dispatcher 与测试共用。 */
export const EMPTY_EXTRACTION_REASON =
  '未提取到任何角色/场景/道具：可能是 LLM 配置问题、输入过短或全部被当成幻觉过滤';

interface FailedBatch {
  batch?: number;
  error?: string;
}

/**
 * 从管道结果的 failedBatches 中提取首个批次错误（截断 200 字）。
 * 空结果的根因几乎总是批次级 LLM 错误（404/401/超时），把它拼进失败文案
 * 能让用户直接看到根因，而不是只看"可能是配置问题"的猜测。
 */
export function firstFailedBatchError(result: unknown): string | null {
  const r = (result && typeof result === 'object' ? result : {}) as Record<string, unknown>;
  if (!Array.isArray(r.failedBatches)) return null;
  for (const entry of r.failedBatches as FailedBatch[]) {
    if (entry && typeof entry.error === 'string' && entry.error.trim()) {
      const trimmed = entry.error.trim();
      return trimmed.length > 200 ? `${trimmed.slice(0, 200)}…` : trimmed;
    }
  }
  return null;
}

/** 空结果失败文案：通用原因 + 首个批次根因（若有）。 */
export function buildEmptyExtractionMessage(result: unknown): string {
  const rootCause = firstFailedBatchError(result);
  return rootCause
    ? `${EMPTY_EXTRACTION_REASON}。首个批次错误：${rootCause}`
    : EMPTY_EXTRACTION_REASON;
}
