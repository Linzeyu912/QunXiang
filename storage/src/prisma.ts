import { PrismaClient } from '@prisma/client';

// 重新导出 Prisma 命名空间，供 api 包等消费方使用事务客户端类型
// （Prisma.TransactionClient），避免每个包各自依赖 @prisma/client。
export { Prisma } from '@prisma/client';

const isProduction = process.env.NODE_ENV === 'production';

function getDatabaseUrl(): string {
  // Production: use DATABASE_URL (PostgreSQL through pgBouncer)
  if (isProduction && process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }
  // Development: prefer direct PostgreSQL if set, then DATABASE_URL, then SQLite
  if (process.env.DATABASE_URL_DEV) {
    return process.env.DATABASE_URL_DEV;
  }
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }
  // Default: SQLite for local development
  return 'file:./prisma/dev.db';
}

export const prisma = new PrismaClient({
  datasources: {
    db: {
      url: getDatabaseUrl(),
    },
  },
  log: isProduction ? ['error'] : ['warn', 'error'],
});

export async function initializeDatabase() {
  await prisma.$connect();
}

export async function closeDatabase() {
  await prisma.$disconnect();
}
