/**
 * 制片人 Producer 端到端运行脚本.
 *
 * 主 agent（ProducerAgent）跑 scheduler 的 4-agent 富管道：
 *   extractor → validator → entity-resolution → reviewer
 * （含 prescan、三类实体 character/location/item、story-arcs、importance、DB 入库）
 *
 * 用法：
 *   pnpm exec tsx run_producer.mjs [小说路径] [书名]
 */
import { readFileSync, statSync } from 'fs';
import { resolve } from 'path';

// ── 1. 必须在 import storage/agent/scheduler 之前设置 DATABASE_URL ──
process.env.DATABASE_URL = process.env.DATABASE_URL || 'file:D:/entity/storage/prisma/dev.db';

// ── 2. 加载 .env（LLM 配置）──
try {
  // 脚本位于 scripts/，需回到仓库根目录读 .env
  const envContent = readFileSync(new URL('../.env', import.meta.url), 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq > 0) {
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  }
} catch {
  console.warn('[run_producer] 未找到 .env，LLM 可能未配置');
}

const filePath = resolve(process.argv[2] || 'D:/entity/test/《斗破苍穹》 1-10.txt');
const title = process.argv[3] || '斗破苍穹 1-10';

console.log('╔══════════════════════════════════════════════╗');
console.log('║   制片人 Producer 端到端管道运行              ║');
console.log('╚══════════════════════════════════════════════╝');
console.log(`\n文件: ${filePath}\n书名: ${title}`);
console.log(`DATABASE_URL: ${process.env.DATABASE_URL}`);
console.log(`LLM_PROVIDER: ${process.env.LLM_PROVIDER} | LLM_MODEL: ${process.env.LLM_MODEL}`);

// ── 3. 播种 User + Book（find-or-create by filePath）──
const {
  UserRepository,
  BookRepository,
  CharacterRepository,
  LocationRepository,
  ItemRepository,
  closeDatabase,
} = await import('@novel-agent/storage');
const { ProducerAgent } = await import('@novel-agent/agent');

const user = await UserRepository.findOrCreate({ email: 'producer@local', name: 'producer' });
const stat = statSync(filePath);

const existing = await BookRepository.findAll(user.id);
let book = existing.find((b) => b.filePath === filePath);
if (!book) {
  book = await BookRepository.create({
    title,
    filePath,
    fileSize: stat.size,
    mimeType: 'text/plain',
    userId: user.id,
  });
}
console.log(`\n📚 Book 已就绪: ${book.title} (id=${book.id}, ${(stat.size / 1024).toFixed(1)} KB)`);

// 清理该书旧实体，保证重跑不重复入库
for (const repo of [CharacterRepository, LocationRepository, ItemRepository]) {
  try {
    await repo.deleteByBookId(book.id);
  } catch {
    /* 首次运行无数据，忽略 */
  }
}

// ── 4. 制片人跑整条管道 ──
const producer = new ProducerAgent();
const result = await producer.run(book.id, user.id);

// ── 5. 阶段报告 ──
console.log('\n━━━━━━━━━━━━━━ 制片人阶段报告 ━━━━━━━━━━━━');
console.log('agent                阶段         结果  耗时      progress');
for (const s of result.stages) {
  const tag = s.success ? '✅' : '❌';
  console.log(
    `${s.agent.padEnd(20)} ${s.name.padEnd(8)} ${tag}  ${String(s.durationMs).padStart(7)}ms  ${(s.progress ?? '') + '%'}${s.error ? '  ⚠ ' + s.error : ''}`
  );
}
console.log(`\n总耗时: ${result.totalDurationMs}ms   最终: ${result.success ? '✅ 成功' : '❌ 失败'}`);
if (result.message) console.log(`信息: ${result.message}`);

// ── 6. 入库三类实体数（scheduler dispatcher 已在 entity-resolution 后写库）──
console.log('\n━━━━━━━━━━━━━━ 入库实体 ━━━━━━━━━━━━');
for (const [name, repo] of [['角色', CharacterRepository], ['地点', LocationRepository], ['物品', ItemRepository]]) {
  try {
    const rows = await repo.findByBookId(book.id);
    const sample = rows.slice(0, 8).map((r) => r.name).join('、');
    console.log(`  ${name}: ${rows.length} 个${sample ? '  样本: ' + sample : ''}`);
  } catch (e) {
    console.log(`  ${name}: 读取失败 — ${e instanceof Error ? e.message : e}`);
  }
}

await closeDatabase();
process.exit(result.success ? 0 : 1);
