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
  totalCount: number;
}

export function summarizeExtractionResult(result: unknown): ExtractionResultSummary {
  const r = (result && typeof result === 'object' ? result : {}) as Record<string, unknown>;
  const characters = Array.isArray(r.characters) ? r.characters : [];
  const locations = Array.isArray(r.locations) ? r.locations : [];
  const items = Array.isArray(r.items) ? r.items : [];
  return {
    characters,
    locations,
    items,
    totalCount: characters.length + locations.length + items.length,
  };
}

/** 空结果（三类实体全无）时的失败原因，供 dispatcher 与测试共用。 */
export const EMPTY_EXTRACTION_REASON =
  '未提取到任何角色/场景/道具：可能是 LLM 配置问题、输入过短或全部被当成幻觉过滤';
