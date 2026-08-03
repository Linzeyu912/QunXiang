import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('前端认证入口', () => {
  it('不再导出固定默认账号凭据或静默登录函数', async () => {
    const source = await readFile(new URL('./auth.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('export const DEFAULT_CREDENTIALS');
    expect(source).not.toContain('export async function loginDefaultUser');
  });
});
