// vitest 全局 setup（由根 vitest.config.ts 的 setupFiles 挂载）。
// 标准测试流程 scripts/test.mjs 已把 DATABASE_URL/DIRECT_DATABASE_URL 指向含 test 的测试库；
// 本文件是第二道防线：绕过 test.mjs 直接跑 vitest 时，任何测试文件只要 import 了
// @qunxiang/storage 的 prisma 单例，都必须先指向含 test 的库名，否则直接失败——
// 防止测试清库误伤生产/开发库。
function ensureTestDatabase(): void {
  const url = process.env.DATABASE_URL || process.env.DIRECT_DATABASE_URL || '';
  if (!url) {
    throw new Error('测试未配置 DATABASE_URL：请通过 pnpm test（scripts/test.mjs）运行，或自行指向含 test 的测试库');
  }
  let dbName = '';
  try {
    dbName = new URL(url).pathname.replace(/^\//, '').split('?')[0];
  } catch {
    throw new Error(`测试 DATABASE_URL 无法解析：${url}`);
  }
  if (!dbName) {
    throw new Error(`测试 DATABASE_URL 未包含库名：${url}`);
  }
  if (!/test/i.test(dbName)) {
    throw new Error(
      `测试 DATABASE_URL 的库名「${dbName}」不含 test，已拒绝连接：为防止误连生产/开发库，测试库名必须包含 test`
    );
  }
}

ensureTestDatabase();

export default ensureTestDatabase;
