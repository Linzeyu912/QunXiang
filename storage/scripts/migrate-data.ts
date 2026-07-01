/**
 * Data migration script: SQLite -> PostgreSQL
 *
 * Usage:
 *   cp ../prisma/dev.db ../prisma/dev.db.backup  # Create backup first!
 *   pnpm db:migrate-data
 *
 * Prerequisites:
 *   1. PostgreSQL running and accessible
 *   2. DATABASE_URL_DEV pointing to PostgreSQL
 *   3. Run: pnpm prisma db push --accept-data-loss
 */

import { PrismaClient } from '@prisma/client';
import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlitePath = join(__dirname, '../prisma/dev.db');

async function migrateUsers(pg: PrismaClient, sqlite: Database.Database) {
  const users = sqlite.prepare('SELECT * FROM User').all();
  console.log(`Migrating ${users.length} users...`);

  for (const user of users as any[]) {
    await pg.user.upsert({
      where: { id: user.id },
      update: {},
      create: {
        id: user.id,
        email: user.email,
        name: user.name,
        createdAt: new Date(user.createdAt),
      },
    });
  }
  console.log('Users migrated.');
}

async function migrateBooks(pg: PrismaClient, sqlite: Database.Database) {
  const books = sqlite.prepare('SELECT * FROM Book').all();
  console.log(`Migrating ${books.length} books...`);

  for (const book of books as any[]) {
    await pg.book.upsert({
      where: { id: book.id },
      update: {},
      create: {
        id: book.id,
        title: book.title,
        content: book.content,
        status: book.status,
        userId: book.userId,
        createdAt: new Date(book.createdAt),
        updatedAt: new Date(book.updatedAt),
      },
    });
  }
  console.log('Books migrated.');
}

async function migrateCharacters(pg: PrismaClient, sqlite: Database.Database) {
  const characters = sqlite.prepare('SELECT * FROM Character').all();
  console.log(`Migrating ${characters.length} characters...`);

  for (const char of characters as any[]) {
    await pg.character.upsert({
      where: { id: char.id },
      update: {},
      create: {
        id: char.id,
        bookId: char.bookId,
        name: char.name,
        aliases: char.aliases,
        description: char.description,
        confidence: char.confidence,
        status: char.status,
        chapterRef: char.chapterRef,
        createdAt: new Date(char.createdAt),
        updatedAt: new Date(char.updatedAt),
      },
    });
  }
  console.log('Characters migrated.');
}

async function migrateCharacterReviews(pg: PrismaClient, sqlite: Database.Database) {
  const reviews = sqlite.prepare('SELECT * FROM CharacterReview').all();
  console.log(`Migrating ${reviews.length} character reviews...`);

  for (const review of reviews as any[]) {
    await pg.characterReview.upsert({
      where: { id: review.id },
      update: {},
      create: {
        id: review.id,
        characterId: review.characterId,
        userId: review.userId,
        action: review.action,
        previousValue: review.previousValue,
        newValue: review.newValue,
        createdAt: new Date(review.createdAt),
      },
    });
  }
  console.log('Character reviews migrated.');
}

async function migrateExtractionSessions(pg: PrismaClient, sqlite: Database.Database) {
  const sessions = sqlite.prepare('SELECT * FROM ExtractionSession').all();
  console.log(`Migrating ${sessions.length} extraction sessions...`);

  for (const session of sessions as any[]) {
    await pg.extractionSession.upsert({
      where: { id: session.id },
      update: {},
      create: {
        id: session.id,
        bookId: session.bookId,
        userId: session.userId,
        status: session.status,
        createdAt: new Date(session.createdAt),
        completedAt: session.completedAt ? new Date(session.completedAt) : null,
      },
    });
  }
  console.log('Extraction sessions migrated.');
}

async function migrateTasks(pg: PrismaClient, sqlite: Database.Database) {
  const tasks = sqlite.prepare('SELECT * FROM Task').all();
  console.log(`Migrating ${tasks.length} tasks...`);

  for (const task of tasks as any[]) {
    await pg.task.upsert({
      where: { id: task.id },
      update: {},
      create: {
        id: task.id,
        bookId: task.bookId,
        agentType: task.agentType,
        payload: task.payload,
        status: task.status,
        result: task.result,
        error: task.error,
        retryCount: task.retryCount,
        deadLettered: Boolean(task.deadLettered),
        failedAt: task.failedAt ? new Date(task.failedAt) : null,
        createdAt: new Date(task.createdAt),
        updatedAt: new Date(task.updatedAt),
      },
    });
  }
  console.log('Tasks migrated.');
}

async function main() {
  console.log('Starting data migration from SQLite to PostgreSQL...\n');
  console.log('SQLite path:', sqlitePath);

  const sqlite = new Database(sqlitePath);
  const pg = new PrismaClient();

  try {
    // Get counts before migration
    const counts = {
      users: (sqlite.prepare('SELECT COUNT(*) as count FROM User').get() as any).count,
      books: (sqlite.prepare('SELECT COUNT(*) as count FROM Book').get() as any).count,
      characters: (sqlite.prepare('SELECT COUNT(*) as count FROM Character').get() as any).count,
      tasks: (sqlite.prepare('SELECT COUNT(*) as count FROM Task').get() as any).count,
    };
    console.log('\nSQLite counts:', counts);

    // Migrate in order (respecting foreign keys)
    await migrateUsers(pg, sqlite);
    await migrateBooks(pg, sqlite);
    await migrateCharacters(pg, sqlite);
    await migrateCharacterReviews(pg, sqlite);
    await migrateExtractionSessions(pg, sqlite);
    await migrateTasks(pg, sqlite);

    console.log('\n✅ Migration completed successfully!');

    // Verify counts
    console.log('\nVerifying counts...');
    const pgCounts = {
      users: await pg.user.count(),
      books: await pg.book.count(),
      characters: await pg.character.count(),
      tasks: await pg.task.count(),
    };
    console.log('PostgreSQL counts:', pgCounts);

    if (
      counts.users === pgCounts.users &&
      counts.books === pgCounts.books &&
      counts.characters === pgCounts.characters &&
      counts.tasks === pgCounts.tasks
    ) {
      console.log('\n✅ All counts match! Data integrity verified.');
    } else {
      console.error('\n⚠️ Count mismatch! Please investigate.');
    }
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  } finally {
    sqlite.close();
    await pg.$disconnect();
  }
}

main();
