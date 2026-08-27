import { LOW_CONFIDENCE_THRESHOLD } from '@qunxiang/core';

/**
 * 实体审核集合：主列表 / 低置信度库 / 已拒绝列表，三者互斥。
 * - LOW_CONFIDENCE：低置信度且仍待审核（PENDING）的实体。
 * - REJECTED：已被拒绝的实体（不论置信度）。
 * - MAIN：其余实体（含已通过、以及高置信度待审核）。
 */
export type ReviewBucket = 'MAIN' | 'LOW_CONFIDENCE' | 'REJECTED';

/** 三个审核集合（主列表/低置信度库/已拒绝列表）的独立数量。 */
export type ReviewBucketCounts = Record<ReviewBucket, number>;

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
 */
export function reviewBucketWhere(bucket: ReviewBucket): Record<string, unknown> {
  switch (bucket) {
    case 'LOW_CONFIDENCE':
      return { ...lowConfidencePending };
    case 'REJECTED':
      return { status: 'REJECTED' };
    case 'MAIN':
    default:
      return { status: { not: 'REJECTED' }, NOT: lowConfidencePending };
  }
}

/** 解析集合查询参数：reviewBucket 优先，confidence=low 保留为兼容别名。 */
export function parseReviewBucket(params: { reviewBucket?: string; confidence?: string }): ReviewBucket | null {
  if (params.reviewBucket) {
    const bucket = params.reviewBucket.toUpperCase();
    if (bucket === 'MAIN' || bucket === 'LOW_CONFIDENCE' || bucket === 'REJECTED') return bucket;
    return null;
  }
  if (params.confidence === 'low') return 'LOW_CONFIDENCE';
  return 'MAIN';
}
