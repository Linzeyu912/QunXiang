import { PrismaClient } from '@prisma/client';

async function main(): Promise<void> {
  console.log('DATABASE_URL:', process.env.DATABASE_URL);
  const prisma = new PrismaClient();
  const tables = await prisma.$queryRawUnsafe<{ name: string }[]>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='Task'",
  );
  console.log('Task table:', tables);
  await prisma.$disconnect();
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
