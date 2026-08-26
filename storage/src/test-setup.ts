import { PrismaClient } from '@prisma/client';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
if (!TEST_DB_URL) {
  throw new Error('未配置 TEST_DATABASE_URL，已拒绝连接测试数据库');
}

// 隔离保护：测试会执行全表清理，测试库名必须含 test，防止误连生产/开发库
// （标准测试流程 test-runner.mjs 已默认指向含 test 的测试库，符合该规则；
// 不与 process.env.DATABASE_URL 比较，因为 test-runner 会故意把两者都设为测试库）。
try {
  const testDbName = new URL(TEST_DB_URL).pathname.replace(/^\//, '').split('?')[0];
  if (!testDbName) {
    throw new Error('TEST_DATABASE_URL 未包含库名');
  }
  if (!/test/i.test(testDbName)) {
    throw new Error(
      `TEST_DATABASE_URL 的库名「${testDbName}」不含 test，已拒绝连接：为防止误连生产/开发库，测试库名必须包含 test`
    );
  }
} catch (err) {
  if (err instanceof Error && err.message.includes('已拒绝连接')) throw err;
  throw new Error(`TEST_DATABASE_URL 无法解析：${TEST_DB_URL}`);
}

export const testPrisma = new PrismaClient({
  datasources: {
    db: {
      url: TEST_DB_URL,
    },
  },
  log: ['error'],
});

export async function cleanupTestDb() {
  await testPrisma.$disconnect();
}

export { TEST_DB_URL };
