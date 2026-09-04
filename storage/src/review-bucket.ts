import { LOW_CONFIDENCE_THRESHOLD } from '@qunxiang/core';

/**
 * 实体审核集合：主列表 / 低置信度库 / 已拒绝列表，三者互斥；ALL 为不限状态的完整视图。
 * - LOW_CONFIDENCE：低置信度且仍待审核（PENDING）的实体。
 * - REJECTED：已被拒绝的实体（不论置信度）。
 * - MAIN：其余实体（含已通过、以及高置信度待审核）。
 * - ALL：待审核/已通过/已拒绝全部包含，仅排除低置信度待审（由低置信度库单独承接）与已归档；
 *   供审核页「全部状态」筛选使用，与页面上 待审核/已通过/已拒绝 三个选项构成完整并集。
 */
export type ReviewBucket = 'MAIN' | 'LOW_CONFIDENCE' | 'REJECTED' | 'ALL';

/** 三个互斥审核集合（主列表/低置信度库/已拒绝列表）的独立数量；ALL 是全集视图，不参与计数。 */
export type ReviewBucketCounts = Record<Exclude<ReviewBucket, 'ALL'>, number>;

export interface ReviewBucketQuery {
  bookId: string;
  ownerId: string;
  bucket: ReviewBucket;
  status?: string;
  tier?: string;
  category?: string;
  /** 游标（上一页最后一条的 id），与 createdAt 升序一起保证稳定翻页。 */
  cursor?: string;
  limit?: number;
}

/** 低置信度待审核条件（与 core 的 isLowConfidenceEntity 保持一致，只认 PENDING）。 */
const lowConfidencePending = {
  confidence: { lt: LOW_CONFIDENCE_THRESHOLD },
  status: 'PENDING',
} as const;

/**
 * 构造各实体模型 where 子句中的集合过滤部分。
 * 返回对象直接展开进 Prisma where；类型由调用方按各自模型收窄。
 * 三个集合都排除已归档实体（实施包 D4：纯 AI 且新结果不再出现的实体归档不删）。
 */
export function reviewBucketWhere(bucket: ReviewBucket): Record<string, unknown> {
  switch (bucket) {
    case 'LOW_CONFIDENCE':
      return { ...lowConfidencePending, archivedAt: null };
    case 'REJECTED':
      return { status: 'REJECTED', archivedAt: null };
    case 'ALL':
      return { archivedAt: null, NOT: lowConfidencePending };
    case 'MAIN':
    default:
      return { status: { not: 'REJECTED' }, archivedAt: null, NOT: lowConfidencePending };
  }
}

/** 解析集合查询参数：reviewBucket 优先，confidence=low 保留为兼容别名；缺省归入 MAIN 主列表。 */
export function parseReviewBucket(params: { reviewBucket?: string; confidence?: string }): ReviewBucket | null {
  if (params.reviewBucket) {
    const bucket = params.reviewBucket.toUpperCase();
    if (bucket === 'MAIN' || bucket === 'LOW_CONFIDENCE' || bucket === 'REJECTED' || bucket === 'ALL') return bucket;
    return null;
  }
  if (params.confidence === 'low') return 'LOW_CONFIDENCE';
  return 'MAIN';
}
