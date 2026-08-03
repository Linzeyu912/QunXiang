import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTests } from './test-runner.mjs';

function run(command, args, options = {}) {
  return new Promise((resolveRun, reject) => {
    const windows = process.platform === 'win32';
    const executable = windows ? 'cmd.exe' : command;
    const executableArgs = windows ? ['/d', '/s', '/c', command, ...args] : args;
    const child = spawn(executable, executableArgs, {
      cwd: options.cwd,
      env: options.env,
      stdio: 'inherit',
      shell: false,
    });
    child.once('error', reject);
    child.once('exit', (status) => resolveRun({ status: status ?? 1 }));
  });
}

export async function main({
  env = process.env,
  argv = process.argv.slice(2),
  runCommand = run,
} = {}) {
  return runTests({ env, argv, run: runCommand });
}

const isMain = process.argv[1]
  && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  main().catch((error) => {
    console.error('测试执行失败：', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
