import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('群像加密模型配置目录', () => {
  it('优先使用环境变量指定的共享配置目录', async () => {
    const source = await readFile(new URL('./configStore.ts', import.meta.url), 'utf8');

    expect(source).toContain('QUNXIANG_CONFIG_DIR');
    expect(source).toMatch(/process\.env\.QUNXIANG_CONFIG_DIR[\s\S]*getProjectRoot\(\)/);
  });

  it('新文件名统一使用群像，并兼容读取旧配置', async () => {
    const source = await readFile(new URL('./configStore.ts', import.meta.url), 'utf8');

    expect(source).toContain('.qunxiang-config.encrypted');
    expect(source).toContain('getLegacyConfigPath');
  });
});
