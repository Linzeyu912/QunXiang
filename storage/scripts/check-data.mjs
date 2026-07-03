import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();

const [books, characters, locations, items, tasks] = await Promise.all([
  db.book.count(),
  db.character.count(),
  db.location.count(),
  db.item.count(),
  db.task.count(),
]);

console.log('Books:      ', books);
console.log('Characters: ', characters);
console.log('Locations:  ', locations);
console.log('Items:      ', items);
console.log('Tasks:      ', tasks);

console.log('\n--- Recent books ---');
const recentBooks = await db.book.findMany({ orderBy: { createdAt: 'desc' }, take: 3 });
for (const b of recentBooks) {
  console.log(`  ${b.id.slice(0, 8)}  ${b.status.padEnd(12)}  ${b.title}`);
}

console.log('\n--- Tasks by (agent, status) ---');
const grouped = await db.task.groupBy({ by: ['agentType', 'status'], _count: true });
for (const g of grouped) {
  console.log(`  ${g.agentType.padEnd(22)}  ${g.status.padEnd(12)}  ${g._count}`);
}

const failed = await db.task.findMany({ where: { status: 'failed' }, take: 3, orderBy: { createdAt: 'desc' } });
if (failed.length > 0) {
  console.log('\n--- Recent failed tasks ---');
  for (const t of failed) {
    console.log(`  agent=${t.agentType}  error=${(t.error ?? '').slice(0, 200)}`);
  }
}

await db.$disconnect();
