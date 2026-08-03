import { describe, expect, it } from 'vitest';
import { createShareCode, verifyShareCode } from './share-code.js';

describe('账号分享码', () => {
  it('只保存摘要且错误码无法通过验证', () => {
    const value = createShareCode();
    expect(value.plain).not.toBe(value.hash);
    expect(value.plain.length).toBeGreaterThanOrEqual(32);
    expect(verifyShareCode(value.plain, value.hash)).toBe(true);
    expect(verifyShareCode('错误分享码', value.hash)).toBe(false);
    expect(verifyShareCode(value.plain, '无效摘要')).toBe(false);
  });
});
