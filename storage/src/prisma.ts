import { PrismaClient } from '@prisma/client';

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
  log: isProduction ? ['error'] : ['query', 'error'],
});

export async function initializeDatabase() {
  await prisma.$connect();
}

export async function closeDatabase() {
  await prisma.$disconnect();
}
