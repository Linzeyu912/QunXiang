#!/usr/bin/env node
/**
 * 数据库密码自愈脚本
 *
 * 解决 PostgreSQL Docker 的经典坑：
 *   POSTGRES_PASSWORD 只在【首次创建 volume】时写入数据目录，
 *   之后修改 docker-compose.yml / 环境变量都不会更新已固化在 volume 里的密码。
 *   一旦 volume 被不同密码初始化过，prisma migrate 就会报 P1000 认证失败，
 *   而且每次 start.bat 都会卡在这里——这就是“经常迁移失败”的根因。
 *
 * 本脚本在每次启动时，把数据库用户的密码强制同步成 storage/.env 里
 * DATABASE_URL 中配置的值（ALTER USER 是幂等操作，安全无副作用）。
 *
 * 用法：node scripts/sync-db-password.mjs
 * 退出码：0 成功 / 1 失败
 */
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const CONTAINER = process.env.PG_CONTAINER || 'qunxiang-postgres';

// ── 1. 读取 storage/.env 中的 DATABASE_URL（prisma 实际使用的连接串，作为唯一真相源）──
const envPath = join(ROOT, 'storage', '.env');
if (!existsSync(envPath)) {
  console.error(`[错误] 未找到 ${envPath}。`);
  console.error('  请先运行 start.bat 生成环境配置，或手动创建该文件并写入 DATABASE_URL。');
  process.exit(1);
}
const envText = readFileSync(envPath, 'utf8');
const m = envText.match(/^DATABASE_URL\s*=\s*(.+)$/m);
if (!m) {
  console.error(`[错误] ${envPath} 中未配置 DATABASE_URL。`);
  process.exit(1);
}
const dbUrl = m[1].trim();

// ── 2. 解析连接串 ──
let parsed;
try {
  parsed = new URL(dbUrl);
} catch {
  console.error(`[错误] DATABASE_URL 格式无效：${dbUrl}`);
  process.exit(1);
}
if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
  console.error(`[错误] DATABASE_URL 必须是 PostgreSQL 地址，当前协议为 ${parsed.protocol}`);
  process.exit(1);
}
const user = decodeURIComponent(parsed.username) || 'qunxiang';
const pass = decodeURIComponent(parsed.password);
const dbName = decodeURIComponent(parsed.pathname.replace(/^\//, '')) || 'qunxiang';

if (!pass) {
  console.error('[错误] DATABASE_URL 中未包含密码，无法同步。');
  process.exit(1);
}

// ── 3. 检查 PostgreSQL 容器是否在运行 ──
function isContainerRunning(name) {
  const r = spawnSync('docker', ['inspect', '-f', '{{.State.Running}}', name], {
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (r.status !== 0) return false;
  return r.stdout.toString().trim() === 'true';
}

if (!isContainerRunning(CONTAINER)) {
  console.error(`[错误] PostgreSQL 容器 ${CONTAINER} 未运行。`);
  console.error('  请先启动 Docker Desktop，并运行 start.bat 的 PostgreSQL 启动步骤。');
  process.exit(1);
}

// ── 4. 通过容器内 unix socket（默认 trust）执行 ALTER USER 同步密码 ──
// PostgreSQL 字符串字面量中的单引号需写成两个单引号
const escapedPass = pass.replace(/'/g, "''");
const sql = `ALTER USER "${user}" PASSWORD '${escapedPass}';`;

// 用 spawnSync 传数组参数，完全避开各平台 shell 的引号转义问题
const r = spawnSync(
  'docker',
  ['exec', CONTAINER, 'psql', '-U', user, '-d', dbName, '-v', 'ON_ERROR_STOP=1', '-c', sql],
  { stdio: 'inherit' }
);

if (r.status !== 0) {
  console.error('[错误] 同步数据库密码失败。');
  console.error(`  可手动排查：docker exec ${CONTAINER} psql -U ${user} -d ${dbName} -c "${sql}"`);
  process.exit(1);
}

console.log(`✓ 数据库密码已同步为 .env 配置的值（用户：${user}，库：${dbName}）。`);
