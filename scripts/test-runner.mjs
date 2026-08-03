import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertSafeTestDatabaseUrl,
  collectProductionDatabaseUrls,
} from './test-database-url.mjs';

export const DEFAULT_TEST_DATABASE_URL =
  'postgresql://novel_agent_test:novel_agent_test@127.0.0.1:55432/novel_agent_test';

// 对象存储集成测试默认指向本地 MinIO；逐个键允许外部环境覆盖。
const DEFAULT_OBJECT_STORAGE = {
  PROVIDER: 's3',
  ENDPOINT: 'http://127.0.0.1:9000',
  REGION: 'us-east-1',
  BUCKET: 'novel-agent-test',
  ACCESS_KEY_ID: 'novel_agent_test',
  SECRET_ACCESS_KEY: 'novel_agent_test',
  S3_FORCE_PATH_STYLE: 'true',
  SIGN_SECRET: 'test-object-storage-sign-secret',
};

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKSPACE_PACKAGES = [
  'core', 'schemas', 'storage', 'import', 'extractors', 'validators',
  'entity-resolution', 'scheduler', 'agent', 'preprocess', 'entity-prescan', 'llm',
  'exporters', 'prompts', 'story-arcs',
];

/** 清理 src 下遗留的编译产物，避免同名旧 .js 屏蔽最新的 .ts 源码。 */
function cleanStaleSourceArtifacts() {
  let removed = 0;
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const fullPath = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (/\.(?:js|d\.ts|js\.map|d\.ts\.map)$/.test(entry.name)) {
        rmSync(fullPath);
        removed += 1;
      }
    }
  };

  for (const packageName of WORKSPACE_PACKAGES) {
    const sourceDirectory = resolve(root, packageName, 'src');
    try {
      walk(sourceDirectory);
    } catch (error) {
      if ((error)?.code !== 'ENOENT') throw error;
    }
  }

  if (removed > 0) {
    console.log(`[test] 已清理 ${removed} 个 src 目录下的遗留编译产物`);
  }
}

async function runChecked(run, command, args, options) {
  const result = await run(command, args, options);
  if (typeof result?.status === 'number' && result.status !== 0) {
    throw new Error(`测试命令失败：${command} ${args.join(' ')}`);
  }
}

export async function runTests({ env, argv, run }) {
  cleanStaleSourceArtifacts();
  const testDatabaseUrl = env.TEST_DATABASE_URL || DEFAULT_TEST_DATABASE_URL;
  const productionUrls = collectProductionDatabaseUrls(env, testDatabaseUrl);
  assertSafeTestDatabaseUrl(testDatabaseUrl, productionUrls);

  // 注册钩子会给每个新用户同步物化公共书库（真实 seed-library，468+ 实体）。
  // 集成测试默认指向空目录关掉它：否则 auth/session 等测试清理 user 时
  // 会被 Book_userId_fkey 外键挡住，且每个测试用户都白跑一遍物化。
  // 需要覆盖的测试（register-seed.integration）会自行设置 SEED_LIBRARY_DIR。
  const emptySeedLibraryDir =
    env.SEED_LIBRARY_DIR ?? join(tmpdir(), 'novel-agent-empty-seed-library');
  mkdirSync(emptySeedLibraryDir, { recursive: true });

  const childEnv = {
    ...env,
    TEST_DATABASE_URL: testDatabaseUrl,
    DATABASE_URL: testDatabaseUrl,
    DIRECT_DATABASE_URL: testDatabaseUrl,
    SEED_LIBRARY_DIR: emptySeedLibraryDir,
    OBJECT_STORAGE_PROVIDER: env.OBJECT_STORAGE_PROVIDER ?? DEFAULT_OBJECT_STORAGE.PROVIDER,
    OBJECT_STORAGE_ENDPOINT: env.OBJECT_STORAGE_ENDPOINT ?? DEFAULT_OBJECT_STORAGE.ENDPOINT,
    OBJECT_STORAGE_REGION: env.OBJECT_STORAGE_REGION ?? DEFAULT_OBJECT_STORAGE.REGION,
    OBJECT_STORAGE_BUCKET: env.OBJECT_STORAGE_BUCKET ?? DEFAULT_OBJECT_STORAGE.BUCKET,
    OBJECT_STORAGE_ACCESS_KEY_ID: env.OBJECT_STORAGE_ACCESS_KEY_ID ?? DEFAULT_OBJECT_STORAGE.ACCESS_KEY_ID,
    OBJECT_STORAGE_SECRET_ACCESS_KEY: env.OBJECT_STORAGE_SECRET_ACCESS_KEY ?? DEFAULT_OBJECT_STORAGE.SECRET_ACCESS_KEY,
    OBJECT_STORAGE_S3_FORCE_PATH_STYLE: env.OBJECT_STORAGE_S3_FORCE_PATH_STYLE ?? DEFAULT_OBJECT_STORAGE.S3_FORCE_PATH_STYLE,
    OBJECT_STORAGE_SIGN_SECRET: env.OBJECT_STORAGE_SIGN_SECRET ?? DEFAULT_OBJECT_STORAGE.SIGN_SECRET,
  };
  const commonOptions = { cwd: root, env: childEnv };
  const requestedArgs = argv[0] === '--' ? argv.slice(1) : [...argv];
  const watch = requestedArgs.includes('--watch');
  const testFiles = requestedArgs.filter((value) => value !== '--watch');

  try {
    await runChecked(run, 'docker', [
      'compose', '-f', 'docker-compose.test.yml', 'up', '-d', '--wait',
      'postgres-test', 'minio-test',
    ], commonOptions);
    await runChecked(run, 'pnpm', [
      '--filter', '@novel-agent/storage', 'exec', 'prisma', 'generate',
      '--schema=./prisma/schema.prisma',
    ], commonOptions);
    await runChecked(run, 'pnpm', [
      '--filter', '@novel-agent/storage', 'exec', 'prisma', 'migrate', 'reset',
      '--force', '--skip-seed', '--schema=./prisma/schema.prisma',
    ], commonOptions);
    await runChecked(run, 'pnpm', [
      'exec', 'vitest', ...(watch ? [] : ['run']), ...testFiles,
    ], commonOptions);
  } finally {
    if (env.KEEP_TEST_DB !== '1') {
      await runChecked(run, 'docker', [
        'compose', '-f', 'docker-compose.test.yml', 'down', '-v',
      ], commonOptions);
    }
  }

  return 0;
}
