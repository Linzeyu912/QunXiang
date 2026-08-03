import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const rootPackageUrl = new URL('../../package.json', import.meta.url);
const testScriptUrl = new URL('../../scripts/test.mjs', import.meta.url);

describe('数据库测试脚本安全', () => {
  it('正式数据库脚本不允许 accept-data-loss', async () => {
    const source = await readFile(rootPackageUrl, 'utf8');
    expect(source).not.toContain('accept-data-loss');
  });

  it('测试入口不硬编码 pnpm store 中的 Prisma 版本', async () => {
    const source = await readFile(testScriptUrl, 'utf8');
    expect(source).not.toMatch(/\.pnpm[\\/]prisma@/);
  });

  it('缺失测试库地址时拒绝执行', async () => {
    const { assertSafeTestDatabaseUrl } = await import('../../scripts/test-database-url.mjs');
    expect(() => assertSafeTestDatabaseUrl('', [])).toThrow('未配置测试数据库地址');
  });

  it('数据库名不是 _test 后缀时拒绝执行', async () => {
    const { assertSafeTestDatabaseUrl } = await import('../../scripts/test-database-url.mjs');
    expect(() => assertSafeTestDatabaseUrl(
      'postgresql://user:pass@127.0.0.1:55432/novel_agent',
      [],
    )).toThrow('测试数据库名称必须以 _test 结尾');
  });

  it('与正式库主机和端口相同时拒绝执行', async () => {
    const { assertSafeTestDatabaseUrl } = await import('../../scripts/test-database-url.mjs');
    expect(() => assertSafeTestDatabaseUrl(
      'postgresql://test:test@db.example.com:5432/novel_agent_test',
      ['postgresql://prod:secret@db.example.com:5432/novel_agent'],
    )).toThrow('测试数据库不得与正式数据库共用主机和端口');
  });

  it('覆盖变量前捕获正式地址且忽略已指向测试库的变量', async () => {
    const { collectProductionDatabaseUrls } = await import('../../scripts/test-database-url.mjs');
    const testUrl = 'postgresql://test:test@127.0.0.1:55432/novel_agent_test';
    expect(collectProductionDatabaseUrls({
      TEST_DATABASE_URL: testUrl,
      DATABASE_URL: 'postgresql://prod:secret@db.example.com:5432/novel_agent',
      DIRECT_DATABASE_URL: testUrl,
      PRODUCTION_DATABASE_URLS: 'postgresql://prod:secret@db-2.example.com:5432/novel_agent',
    }, testUrl)).toEqual([
      'postgresql://prod:secret@db-2.example.com:5432/novel_agent',
      'postgresql://prod:secret@db.example.com:5432/novel_agent',
    ]);
  });

  it('安全校验失败时不启动任何子进程', async () => {
    const { runTests } = await import('../../scripts/test-runner.mjs');
    let callCount = 0;
    await expect(runTests({
      env: { TEST_DATABASE_URL: 'postgresql://test:test@127.0.0.1:55432/novel_agent' },
      argv: [],
      run: async () => { callCount += 1; },
    })).rejects.toThrow('测试数据库名称必须以 _test 结尾');
    expect(callCount).toBe(0);
  });

  it('安全地址被注入两个 Prisma 变量并转发定向文件', async () => {
    const { runTests } = await import('../../scripts/test-runner.mjs');
    const calls: Array<{ command: string; args: string[]; env?: NodeJS.ProcessEnv }> = [];

    await runTests({
      env: {
        TEST_DATABASE_URL: 'postgresql://test:test@127.0.0.1:55432/novel_agent_test',
        KEEP_TEST_DB: '1',
      },
      argv: ['--', 'storage/src/database-scripts.test.ts'],
      run: async (command, args, options) => {
        calls.push({ command, args, env: options?.env });
      },
    });

    const vitest = calls.at(-1);
    expect(vitest?.command).toBe('pnpm');
    expect(vitest?.args).toEqual([
      'exec', 'vitest', 'run', 'storage/src/database-scripts.test.ts',
    ]);
    expect(vitest?.env?.DATABASE_URL).toBe(vitest?.env?.TEST_DATABASE_URL);
    expect(vitest?.env?.DIRECT_DATABASE_URL).toBe(vitest?.env?.TEST_DATABASE_URL);
    expect(calls.map(({ command, args }) => [command, ...args].join(' '))).toEqual([
      'docker compose -f docker-compose.test.yml up -d --wait postgres-test minio-test',
      'pnpm --filter @novel-agent/storage exec prisma generate --schema=./prisma/schema.prisma',
      'pnpm --filter @novel-agent/storage exec prisma migrate reset --force --skip-seed --schema=./prisma/schema.prisma',
      'pnpm exec vitest run storage/src/database-scripts.test.ts',
    ]);
  });

  it('main 返回成功退出码', async () => {
    const { main } = await import('../../scripts/test.mjs');
    const result = await main({
      env: {
        TEST_DATABASE_URL: 'postgresql://test:test@127.0.0.1:55432/novel_agent_test',
        KEEP_TEST_DB: '1',
      },
      argv: [],
      runCommand: async () => undefined,
    });
    expect(result).toBe(0);
  });

  it('中途失败仍执行测试容器清理', async () => {
    const { runTests } = await import('../../scripts/test-runner.mjs');
    const commands: string[] = [];

    await expect(runTests({
      env: {
        TEST_DATABASE_URL: 'postgresql://test:test@127.0.0.1:55432/novel_agent_test',
      },
      argv: [],
      run: async (command, args) => {
        commands.push([command, ...args].join(' '));
        if (args.includes('generate')) throw new Error('模拟生成失败');
      },
    })).rejects.toThrow('模拟生成失败');

    expect(commands.at(-1)).toContain('docker compose -f docker-compose.test.yml down -v');
  });
});
