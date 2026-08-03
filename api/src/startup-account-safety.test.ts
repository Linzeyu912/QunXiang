import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('启动账号安全', () => {
  it('启动入口不导入或调用默认账号归并', async () => {
    const source = await readFile(new URL('./index.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('ensureDefaultUser');
    expect(source).not.toContain('./lib/defaultUser');
  });

  it('buildApp 只构建实例且不监听端口、不写入用户', async () => {
    const source = await readFile(new URL('./app.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('.listen(');
    expect(source).not.toContain('ensureDefaultUser');
  });
});
