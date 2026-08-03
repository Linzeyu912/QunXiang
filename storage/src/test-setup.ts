import { PrismaClient } from '@prisma/client';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
if (!TEST_DB_URL) {
  throw new Error('未配置 TEST_DATABASE_URL，已拒绝连接测试数据库');
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
