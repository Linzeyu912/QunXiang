import { PrismaClient } from '@prisma/client';
import { resolve } from 'node:path';

// Use absolute path for test database - must match where prisma db push creates it
// Prisma creates at: storage/prisma/prisma/test.db (relative to project root)
const TEST_DB_PATH = resolve(process.cwd(), 'storage/prisma/prisma/test.db')
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
