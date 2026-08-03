/**
 * 嵌入式 PostgreSQL 管理脚本
 *
 * 使用 npm embedded-postgres 包，首次运行时自动下载 PG 二进制（约 30MB），
 * 后续直接使用缓存。无需 Docker，无需系统安装 PostgreSQL。
 *
 * 用法:
 *   node scripts/pg-server.mjs start    # 后台启动 PG 守护进程
 *   node scripts/pg-server.mjs stop     # 停止 PG
 *   node scripts/pg-server.mjs status   # 检查 PG 是否在运行
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PG_DATA = resolve(ROOT, 'storage', 'pgdata');
const PG_PORT = 5432;
const PG_DB = 'novel_agent';
const PG_USER = 'novel_agent';
const PG_PASS = 'change_me';

// 通过 embedded-postgres 包获取二进制路径
const require = createRequire(import.meta.url);
const pgBins = require('@embedded-postgres/windows-x64');

function exec(cmd, args = [], opts = {}) {
  try {
    return execSync(`"${cmd}" ${args.join(' ')}`, {
      stdio: opts.stdio || 'pipe',
      encoding: opts.encoding || 'utf-8',
      env: { ...process.env, PGPASSWORD: PG_PASS },
      shell: 'cmd.exe',
      windowsHide: true,
    });
  } catch (e) {
    if (opts.ignoreError) return '';
    throw e;
  }
}

function isRunning() {
  try {
    const r = exec(pgBins.pg_isready, ['-h', '127.0.0.1', '-p', String(PG_PORT)], { ignoreError: true });
    return r.includes('accepting connections');
  } catch {
    return false;
  }
}

async function start() {
  console.log('[PG] 启动嵌入式 PostgreSQL...');

  if (isRunning()) {
    console.log('[PG] PostgreSQL 已在运行中');
    return;
  }

  // 首次初始化数据目录
  if (!existsSync(resolve(PG_DATA, 'PG_VERSION'))) {
    console.log('[PG] 首次初始化数据目录（二进制已缓存，后续秒启）...');
    mkdirSync(PG_DATA, { recursive: true });

    exec(pgBins.initdb, [
      '--no-locale',
      '--encoding=UTF8',
      '-U', PG_USER,
      '-D', PG_DATA,
    ]);
    console.log('[PG] 数据目录初始化完成');
  }

  // 后台启动
  console.log('[PG] 启动服务...');
  const logFile = resolve(PG_DATA, 'pg.log');

  exec(pgBins.pg_ctl, [
    'start',
    '-D', PG_DATA,
    '-l', logFile,
    '-o', `-p${PG_PORT}`,
  ]);

  // 等待就绪
  let retries = 30;
  while (retries > 0) {
    if (isRunning()) break;
    retries--;
    await new Promise(r => setTimeout(r, 1000));
  }

  if (retries === 0) {
    console.error('[PG] PostgreSQL 启动超时。日志:', logFile);
    try {
      const log = readFileSync(logFile, 'utf-8').split('\n').slice(-20).join('\n');
      console.error(log);
    } catch {}
    process.exit(1);
  }

  console.log('[PG] PostgreSQL 已就绪 (127.0.0.1:5432)');

  // 确保数据库存在
  const dbExists = exec(pgBins.psql, [
    '-h', '127.0.0.1', '-p', String(PG_PORT),
    '-U', 'postgres',
    '-tAc', `SELECT 1 FROM pg_database WHERE datname='${PG_DB}'`,
  ], { ignoreError: true }).trim();

  if (dbExists !== '1') {
    console.log('[PG] 创建数据库 novel_agent...');
    exec(pgBins.createdb, ['-h', '127.0.0.1', '-p', String(PG_PORT), '-U', 'postgres', PG_DB]);
  }

  // 确保用户存在
  const userExists = exec(pgBins.psql, [
    '-h', '127.0.0.1', '-p', String(PG_PORT),
    '-U', 'postgres',
    '-tAc', `SELECT 1 FROM pg_roles WHERE rolname='${PG_USER}'`,
  ], { ignoreError: true }).trim();

  if (userExists !== '1') {
    console.log('[PG] 创建用户 novel_agent...');
    exec(pgBins.psql, [
      '-h', '127.0.0.1', '-p', String(PG_PORT),
      '-U', 'postgres',
      '-c', `CREATE USER ${PG_USER} WITH PASSWORD '${PG_PASS}'; GRANT ALL ON DATABASE ${PG_DB} TO ${PG_USER};`,
    ]);
  }

  console.log('[PG] PostgreSQL 启动完成');
}

function stop() {
  console.log('[PG] 停止 PostgreSQL...');
  try {
    exec(pgBins.pg_ctl, ['stop', '-D', PG_DATA], { ignoreError: true });
    console.log('[PG] 已停止');
  } catch {
    console.log('[PG] PostgreSQL 未在运行');
  }
}

function status() {
  if (isRunning()) {
    console.log('[PG] PostgreSQL 正在运行');
  } else {
    console.log('[PG] PostgreSQL 未运行');
  }
}

const cmd = process.argv[2];
switch (cmd) {
  case 'start': await start(); break;
  case 'stop': stop(); break;
  case 'status': status(); break;
  default:
    console.log('用法: node scripts/pg-server.mjs <start|stop|status>');
    process.exit(1);
}
