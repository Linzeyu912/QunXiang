import { spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const testDb = resolve(root, 'storage', 'prisma', 'test.db').replaceAll('\\', '/');
const env = { ...process.env, DATABASE_URL: `file:${testDb}` };
const watch = process.argv.includes('--watch');

mkdirSync(resolve(root, 'storage', 'prisma'), { recursive: true });
closeSync(openSync(testDb, 'a'));

// 清理各 workspace 包 src 下可能残留的 tsc 编译产物（.js/.d.ts/.map）。
// 历史上这些产物会屏蔽对 .ts 源码的修改（源码 import './xxx.js' 后缀时 bundler
// 优先加载真实存在的 stale .js），导致「改了代码测试行为不变」的隐蔽 bug。
// 各包 main 指向 src 源码、走 tsx 即时编译，不需要这些产物。
const PACKAGES = ['core', 'schemas', 'storage', 'import', 'extractors', 'validators',
  'entity-resolution', 'scheduler', 'preprocess', 'entity-prescan', 'llm', 'exporters',
  'prompts', 'story-arcs'];
let removedArtifacts = 0;
for (const pkg of PACKAGES) {
  const srcDir = resolve(root, pkg, 'src');
  let exists = true;
  try { statSync(srcDir); } catch { exists = false; }
  if (!exists) continue;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (/\.(?:js|d\.ts|js\.map|d\.ts\.map)$/.test(entry.name)) {
        rmSync(full); removedArtifacts++;
      }
    }
  };
  walk(srcDir);
}
if (removedArtifacts > 0) {
  console.log(`[test] 清理了 ${removedArtifacts} 个 src 下残留编译产物（防 stale .js 屏蔽 .ts 修改）`);
}

function run(command, args, options = {}) {
  const executable = process.platform === 'win32' ? 'cmd.exe' : command;
  const executableArgs = process.platform === 'win32' ? ['/d', '/s', '/c', command, ...args] : args;
  const result = spawnSync(executable, executableArgs, {
    cwd: root,
    env,
    stdio: 'inherit',
    shell: false,
    ...options,
  });
  if (result.error) {
    console.error(result.error.message);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run('pnpm', [
  'prisma',
  'db',
  'push',
  '--schema=./prisma/schema.prisma',
  '--force-reset',
  '--skip-generate',
], { cwd: resolve(root, 'storage') });

run('pnpm', ['exec', 'vitest', ...(watch ? [] : ['run'])]);
