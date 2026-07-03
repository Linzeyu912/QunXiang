import { spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const testDb = resolve(root, 'storage', 'prisma', 'test.db').replaceAll('\\', '/');
const env = { ...process.env, DATABASE_URL: `file:${testDb}` };
const watch = process.argv.includes('--watch');

mkdirSync(resolve(root, 'storage', 'prisma'), { recursive: true });
closeSync(openSync(testDb, 'a'));

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
