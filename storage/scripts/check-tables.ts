import { PrismaClient } from '@prisma/client';

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const tables = await prisma.$queryRawUnsafe<{ name: string }[]>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma_%'",
  );
  console.log('Tables:', tables.map((t) => t.name));
  await prisma.$disconnect();
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
