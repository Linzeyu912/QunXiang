import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient({ datasources: { db: { url: 'file:D:/ClaudeData/novel-agent/storage/prisma/prisma/dev.db' } } });
async function main() {
  const pending = await prisma.task.findMany({ where: { status: 'pending' } });
  console.log('Pending tasks:', pending.length);
  for (const t of pending) {
    console.log(' -', t.id, t.agentType, 'book:', t.bookId);
  }
  const recent = await prisma.task.findMany({ orderBy: { createdAt: 'desc' }, take: 5 });
  console.log('\nRecent tasks:');
  for (const t of recent) {
    console.log(' -', t.id, t.agentType, 'status:', t.status);
  }
  await prisma.$disconnect();
}
main().catch(console.error);
