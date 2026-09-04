import { describe, expect, it } from 'vitest';
import { LOW_CONFIDENCE_THRESHOLD } from '@qunxiang/core';
import { parseReviewBucket, reviewBucketWhere } from './review-bucket.js';

const lowConfidencePending = {
  confidence: { lt: LOW_CONFIDENCE_THRESHOLD },
  status: 'PENDING',
};

describe('审核集合 where 子句', () => {
  it('MAIN 排除已拒绝与低置信度待审', () => {
    expect(reviewBucketWhere('MAIN')).toEqual({
      status: { not: 'REJECTED' },
      archivedAt: null,
      NOT: lowConfidencePending,
    });
  });

  it('REJECTED 只含已拒绝', () => {
    expect(reviewBucketWhere('REJECTED')).toEqual({ status: 'REJECTED', archivedAt: null });
  });

  it('LOW_CONFIDENCE 只含低置信度待审', () => {
    expect(reviewBucketWhere('LOW_CONFIDENCE')).toEqual({
      ...lowConfidencePending,
      archivedAt: null,
    });
  });

  it('ALL 不限制状态：已拒绝实体在「全部状态」下可见', () => {
    const where = reviewBucketWhere('ALL');
    // 不能带任何 status 等值/排除条件，否则已拒绝实体会被过滤掉
    expect(where).not.toHaveProperty('status');
    // 仍排除已归档与低置信度待审（后者由低置信度库单独承接）
    expect(where).toEqual({ archivedAt: null, NOT: lowConfidencePending });
  });
});

describe('审核集合参数解析', () => {
  it('缺省归入 MAIN 主列表', () => {
    expect(parseReviewBucket({})).toBe('MAIN');
  });

  it('reviewBucket 大小写不敏感，支持 ALL', () => {
    expect(parseReviewBucket({ reviewBucket: 'all' })).toBe('ALL');
    expect(parseReviewBucket({ reviewBucket: 'Main' })).toBe('MAIN');
    expect(parseReviewBucket({ reviewBucket: 'low_confidence' })).toBe('LOW_CONFIDENCE');
    expect(parseReviewBucket({ reviewBucket: 'REJECTED' })).toBe('REJECTED');
  });

  it('非法值返回 null 交给路由返回 400', () => {
    expect(parseReviewBucket({ reviewBucket: 'EVERYTHING' })).toBeNull();
  });

  it('confidence=low 保留为低置信度库的兼容别名', () => {
    expect(parseReviewBucket({ confidence: 'low' })).toBe('LOW_CONFIDENCE');
  });
});
