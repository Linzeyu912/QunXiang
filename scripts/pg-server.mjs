/**
 * 嵌入式 PostgreSQL 管理脚本（实施包 H3）
 *
 * 使用 embedded-postgres 高层 API（initialise/start/stop/createDatabase），
 * 不再依赖 Windows 二进制包里不存在的 pg_isready / psql / createdb。
 * 就绪检查使用 TCP 探测 + pg 客户端 SQL 探测；配置一律从 DATABASE_URL 解析，
 * 不重复硬编码端口与密码。
 *
 * 用法:
 *   node scripts/pg-server.mjs init      # 初始化数据目录
 *   node scripts/pg-server.mjs start     # 初始化（如需）+ 启动 + 建库 + 就绪等待
 *   node scripts/pg-server.mjs stop      # 停止守护进程
 *   node scripts/pg-server.mjs restart   # 重启
 *   node scripts/pg-server.mjs status    # 运行状态
 *
 * 环境变量（可选）:
 *   DATABASE_URL=postgresql://user:pass@127.0.0.1:5432/dbname
 *   PGDATA_DIR=覆盖数据目录（默认 <仓库>/storage/pgdata）
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { connect as tcpConnect } from 'node:net';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const EmbeddedPostgres = (await import('embedded-postgres')).default;

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ── 配置解析：DATABASE_URL 优先，避免硬编码密码/端口重复 ──
function parseDatabaseUrl(raw) {
  try {
    const url = new URL(raw);
    return {
      user: decodeURIComponent(url.username) || 'qunxiang',
      password: decodeURIComponent(url.password) || 'change_me',
      host: url.hostname || '127.0.0.1',
      port: Number(url.port) || 5432,
      database: url.pathname.replace(/^\//, '') || 'qunxiang',
    };
  } catch {
    return null;
  }
}

const DEFAULTS = { user: 'qunxiang', password: 'change_me', host: '127.0.0.1', port: 5432, database: 'qunxiang' };
const cfg = parseDatabaseUrl(process.env.DATABASE_URL ?? '') ?? DEFAULTS;
const PG_DATA = process.env.PGDATA_DIR ? resolve(process.env.PGDATA_DIR) : resolve(ROOT, 'storage', 'pgdata');

function createServer() {
  return new EmbeddedPostgres({
    databaseDir: PG_DATA,
    user: cfg.user,
    password: cfg.password,
    port: cfg.port,
    persistent: true, // 以后台守护进程方式运行，进程退出不杀 PG
  });
}

/** TCP 就绪探测：可连通返回 true；端口被占用但非本实例时由 SQL 探测甄别。 */
function tcpReady(timeoutMs = 1500) {
  return new Promise((resolvePromise) => {
    const socket = tcpConnect({ host: cfg.host, port: cfg.port }, () => {
      socket.destroy();
      resolvePromise(true);
    });
    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      resolvePromise(false);
    });
    socket.on('error', () => resolvePromise(false));
  });
}

/** SQL 就绪探测：能以配置账号执行 SELECT 1 才算真正就绪。 */
async function sqlReady() {
  let Client;
  try {
    ({ Client } = require('pg'));
  } catch {
    return tcpReady(); // pg 不可用时退化为 TCP 探测
  }
  const client = new Client({ host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, database: 'postgres' });
  try {
    await client.connect();
    await client.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}

async function waitReady(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await sqlReady()) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function init(server) {
  if (existsSync(resolve(PG_DATA, 'PG_VERSION'))) {
    console.log('[PG] 数据目录已存在，跳过初始化');
    return;
  }
  console.log('[PG] 初始化数据目录（首次运行需下载/使用缓存的 PG 二进制）…');
  await server.initialise();
  console.log('[PG] 数据目录初始化完成');
}

async function start() {
  console.log(`[PG] 启动嵌入式 PostgreSQL（${cfg.host}:${cfg.port}，数据库 ${cfg.database}）…`);

  // 端口冲突检测：端口通但 SQL 探测失败说明被其他服务占用
  if (await tcpReady()) {
    if (await sqlReady()) {
      console.log('[PG] PostgreSQL 已在运行且可连接');
    } else {
      console.error(`[PG] 端口 ${cfg.port} 已被其他服务占用（TCP 可达但 PostgreSQL 认证/握手失败）。`);
      console.error('[PG] 请释放该端口，或设置 DATABASE_URL 指向其他端口后重试。');
      process.exit(2);
    }
  } else {
    const server = createServer();
    await init(server);
    await server.start();
    if (!(await waitReady())) {
      console.error('[PG] PostgreSQL 启动超时（30 秒内未就绪）。');
      process.exit(1);
    }
  }

  // 确保目标数据库存在（幂等）
  const server = createServer();
  try {
    await server.createDatabase(cfg.database);
    console.log(`[PG] 数据库「${cfg.database}」就绪`);
  } catch (err) {
    // 已存在时 createDatabase 会报错，视为正常
    const msg = err instanceof Error ? err.message : String(err);
    if (!/already exists|已存在/i.test(msg)) {
      console.warn(`[PG] 建库检查跳过：${msg}`);
    }
  }

  console.log(`[PG] 就绪：postgresql://${cfg.user}:***@${cfg.host}:${cfg.port}/${cfg.database}`);
}

async function stop() {
  console.log('[PG] 停止嵌入式 PostgreSQL…');
  try {
    await createServer().stop();
    console.log('[PG] 已停止');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/not running|未运行/i.test(msg)) {
      console.log('[PG] 未在运行');
    } else {
      console.warn(`[PG] 停止指令返回：${msg}（以端口探测结果为准）`);
    }
  }
}

async function status() {
  const tcp = await tcpReady();
  if (!tcp) {
    console.log('[PG] 未运行（端口不可达）');
    process.exitCode = 1;
    return;
  }
  const sql = await sqlReady();
  console.log(sql ? '[PG] 正在运行（SQL 探测通过）' : '[PG] 端口可达但 SQL 探测失败（可能被其他服务占用或凭据不符）');
}

const cmd = process.argv[2];
switch (cmd) {
  case 'init': {
    const server = createServer();
    await init(server);
    break;
  }
  case 'start':
    await start();
    break;
  case 'stop':
    await stop();
    break;
  case 'restart':
    await stop();
    await new Promise((r) => setTimeout(r, 1000));
    await start();
    break;
  case 'status':
    await status();
    break;
  default:
    console.log('用法: node scripts/pg-server.mjs <init|start|stop|restart|status>');
    process.exit(1);
}
