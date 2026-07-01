/**
 * Rollback script: Revert to SQLite after failed PostgreSQL migration
 *
 * Usage:
 *   pnpm db:rollback
 *
 * This script:
 *   1. Verifies SQLite backup exists
 *   2. Restores dev.db from backup
 *   3. Updates schema to SQLite provider
 */

import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const storageDir = join(__dirname, '..');
const prismaDir = join(storageDir, 'prisma');
const backupPath = join(prismaDir, 'dev.db.backup');
const originalPath = join(prismaDir, 'dev.db');
const schemaPath = join(prismaDir, 'schema.prisma');

async function main() {
  console.log('Starting rollback to SQLite...\n');

  // Check if backup exists
  if (!existsSync(backupPath)) {
    console.error('❌ ERROR: No backup found at:', backupPath);
    console.log('\nTo create a backup before migration:');
    console.log('  cp prisma/dev.db prisma/dev.db.backup');
    process.exit(1);
  }

  console.log('✓ Backup found:', backupPath);

  // Restore SQLite database
  console.log('\nRestoring SQLite database from backup...');
  copyFileSync(backupPath, originalPath);
  console.log('✓ SQLite database restored:', originalPath);

  // Update schema to SQLite
  console.log('\nUpdating schema.prisma to SQLite provider...');
  let schema = readFileSync(schemaPath, 'utf-8');

  // Replace postgresql with sqlite
  schema = schema.replace(
    /provider\s*=\s*"postgresql"/,
    'provider = "sqlite"'
  );

  // Replace DATABASE_URL with file path
  schema = schema.replace(
    /url\s*=\s*env\("DATABASE_URL"\)/,
    'url = "file:./dev.db"'
  );

  writeFileSync(schemaPath, schema);
  console.log('✓ schema.prisma updated to SQLite');

  console.log('\n✅ Rollback completed successfully!');
  console.log('\nNext steps:');
  console.log('  1. Restart your application');
  console.log('  2. Verify SQLite connection works');
  console.log('  3. To re-run PostgreSQL migration:');
  console.log('     - Start PostgreSQL: docker-compose up -d postgres pgbouncer');
  console.log('     - Update schema.prisma back to postgresql');
  console.log('     - Run: pnpm prisma db push --accept-data-loss');
  console.log('     - Run: pnpm db:migrate-data');
}

main();
