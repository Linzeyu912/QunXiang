import { PrismaClient } from '@prisma/client';

// 统一从存储包导出事务客户端类型，业务包无需重复依赖 Prisma 客户端。
export { Prisma } from '@prisma/client';

function getDatabaseUrl(): string {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error('未配置数据库连接地址');
  return value;
}

export const prisma = new PrismaClient({
  datasources: {
    db: {
      url: getDatabaseUrl(),
    },
  },
  log: process.env.NODE_ENV === 'production' ? ['error'] : ['warn', 'error'],
});

export async function initializeDatabase() {
  await prisma.$connect();
}

export async function closeDatabase() {
  await prisma.$disconnect();
}
