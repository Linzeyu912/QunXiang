import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  clearPendingShareCode,
  peekPendingShareCode,
  setPendingShareCode,
} from '../lib/one-time-share-code.js';

describe('账号页面一次性分享码', () => {
  it('明文分享码不写入本地存储，刷新后不会恢复', async () => {
    const source = await readFile(new URL('./AccountPage.tsx', import.meta.url), 'utf8');
    expect(source).toContain('轮换分享码');
    expect(source).toContain('分享码只显示这一次');
    expect(source).not.toContain('localStorage');
    expect(source).not.toContain('sessionStorage');
    expect(source).not.toContain('location.state');

    setPendingShareCode('一次性测试分享码');
    // StrictMode 或并发试渲染可重复读取，渲染阶段不会提前销毁。
    expect(peekPendingShareCode()).toBe('一次性测试分享码');
    expect(peekPendingShareCode()).toBe('一次性测试分享码');
    clearPendingShareCode('一次性测试分享码');
    expect(peekPendingShareCode()).toBeNull();
  });
});
