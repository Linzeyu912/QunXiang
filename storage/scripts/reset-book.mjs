import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();

const bookId = process.argv[2];
if (!bookId) {
  console.error('Usage: node reset-book.mjs <bookId>');
  process.exit(1);
}

await db.character.deleteMany({ where: { bookId } });
await db.location.deleteMany({ where: { bookId } });
await db.item.deleteMany({ where: { bookId } });
await db.task.deleteMany({ where: { bookId } });
await db.book.update({ where: { id: bookId }, data: { status: 'UPLOADED' } });

console.log(`Book ${bookId} reset: characters/locations/items/tasks cleared, status -> UPLOADED`);
await db.$disconnect();
