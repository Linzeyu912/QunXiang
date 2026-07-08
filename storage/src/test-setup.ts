import { PrismaClient } from '@prisma/client';
import { resolve } from 'node:path';

// 测试库路径必须与 scripts/test.mjs 里 prisma db push 创建的位置一致，
// 否则 storage 测试会因 "Unable to open the database file" 全部失败。
// test.mjs 在 cwd=storage 下用 --schema=./prisma/schema.prisma + DATABASE_URL
// 指向 <root>/storage/prisma/test.db，所以这里也用单层 prisma/test.db。
const TEST_DB_PATH = resolve(process.cwd(), 'storage/prisma/test.db')
const TEST_DB_URL = `file:${TEST_DB_PATH}`

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

// Export the URL for prisma db push
export { TEST_DB_URL, TEST_DB_PATH };
