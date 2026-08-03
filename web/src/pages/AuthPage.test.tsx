import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('登录页启动恢复门禁', () => {
  it('启动刷新结束前禁止登录和注册提交', async () => {
    const source = await readFile(new URL('./AuthPage.tsx', import.meta.url), 'utf8');
    expect(source).toContain('const bootstrapping = useAuthStore');
    expect(source).toContain('if (bootstrapping)');
    expect(source).toContain('bootstrapping || login.isPending || register.isPending');
  });
});
