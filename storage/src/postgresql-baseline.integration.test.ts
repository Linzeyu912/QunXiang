import crypto from 'node:crypto';
import { exec } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';

const db = new PrismaClient();
const execAsync = promisify(exec);

const expectedModels = [
  'AssetObject',
  'AssetSnapshot',
  'AuditLog',
  'BackgroundJob',
  'Book',
  'BookArtifact',
  'BookShare',
  'Character',
  'CharacterReview',
  'EntityImage',
  'ExtractionSession',
  'Item',
  'Location',
  'NoiseOverride',
  'RefreshSession',
  'SnapshotObject',
  'Task',
  'User',
];

const requiredIndexes = [
  'AssetObject_objectKey_key',
  'AssetObject_sha256_bytes_key',
  'AssetObject_sha256_idx',
  'AssetSnapshot_book_content_revision',
  'AssetSnapshot_bookId_status_idx',
  'AssetSnapshot_bookId_version_key',
  'AssetSnapshot_ownerId_idx',
  'AuditLog_targetType_targetId_createdAt_idx',
  'BackgroundJob_leaseExpiresAt_idx',
  'BackgroundJob_status_nextRunAt_idx',
  'BackgroundJob_uniqueKey_key',
  'Book_userId_idx',
  'BookShare_bookId_status_idx',
  'BookShare_recipientId_status_idx',
  'BookShare_senderId_idx',
  'RefreshSession_familyId_idx',
  'RefreshSession_tokenHash_key',
  'RefreshSession_userId_idx',
  'SnapshotObject_objectId_idx',
  'SnapshotObject_snapshotId_idx',
  'SnapshotObject_snapshotId_logicalPath_key',
  'Task_bookId_idx',
  'User_emailNormalized_key',
  'User_shareCodeHash_key',
];

afterAll(async () => {
  await db.$disconnect();
});

describe('PostgreSQL baseline', () => {
  it('包含全部 Prisma 模型和阶段一必需索引', async () => {
    const tables = await db.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
      ORDER BY tablename
    `;
    expect(tables.map(({ tablename }) => tablename)).toEqual(expectedModels);

    const indexes = await db.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes WHERE schemaname = 'public'
    `;
    expect(indexes.map(({ indexname }) => indexname)).toEqual(
      expect.arrayContaining(requiredIndexes),
    );
  });

  it('关键列使用 UUID、带时区时间和 JSONB', async () => {
    const rows = await db.$queryRaw<Array<{
      table_name: string;
      column_name: string;
      data_type: string;
      udt_name: string;
    }>>`
      SELECT table_name, column_name, data_type, udt_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (table_name, column_name) IN (
          ('User', 'id'),
          ('User', 'createdAt'),
          ('BackgroundJob', 'payload'),
          ('AuditLog', 'actorId')
        )
    `;
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ table_name: 'User', column_name: 'id', udt_name: 'uuid' }),
      expect.objectContaining({ table_name: 'User', column_name: 'createdAt', data_type: 'timestamp with time zone' }),
      expect.objectContaining({ table_name: 'BackgroundJob', column_name: 'payload', udt_name: 'jsonb' }),
      expect.objectContaining({ table_name: 'AuditLog', column_name: 'actorId', data_type: 'text' }),
    ]));
  });

  it('邮箱规范化值和后台任务唯一键均不可重复', async () => {
    const suffix = crypto.randomUUID();
    let userId: string | undefined;
    try {
      const user = await db.user.create({ data: {
        email: `${suffix}@example.com`,
        emailNormalized: `${suffix}@example.com`,
        name: '测试用户',
        passwordHash: 'scrypt$00$00',
        status: 'ACTIVE',
        shareCodeHash: crypto.createHash('sha256').update(`a:${suffix}`).digest('hex'),
      } });
      userId = user.id;
      await expect(db.user.create({ data: {
        email: `${suffix}@example.com`,
        emailNormalized: `${suffix}@example.com`,
        name: '重复用户',
        passwordHash: 'scrypt$00$00',
        status: 'ACTIVE',
        shareCodeHash: crypto.createHash('sha256').update(`b:${suffix}`).digest('hex'),
      } })).rejects.toMatchObject({ code: 'P2002' });

      await db.backgroundJob.create({ data: {
        kind: 'test', uniqueKey: suffix, payload: {}, status: 'pending',
      } });
      await expect(db.backgroundJob.create({ data: {
        kind: 'test', uniqueKey: suffix, payload: {}, status: 'pending',
      } })).rejects.toMatchObject({ code: 'P2002' });
    } finally {
      await db.backgroundJob.deleteMany({ where: { uniqueKey: suffix } });
      if (userId) await db.user.deleteMany({ where: { id: userId } });
    }
  });

  it('账号和后台任务状态 CHECK 拒绝未知值', async () => {
    const suffix = crypto.randomUUID();
    const user = await db.user.create({ data: {
      email: `${suffix}@example.com`,
      emailNormalized: `${suffix}@example.com`,
      name: '状态测试用户',
      passwordHash: 'scrypt$00$00',
      status: 'ACTIVE',
      shareCodeHash: crypto.createHash('sha256').update(suffix).digest('hex'),
    } });
    const job = await db.backgroundJob.create({ data: {
      kind: 'test', uniqueKey: suffix, payload: {}, status: 'pending',
    } });
    try {
      await expect(db.$executeRawUnsafe(
        'UPDATE "User" SET status = $1 WHERE id = $2', 'UNKNOWN', user.id,
      )).rejects.toThrow();
      await expect(db.$executeRawUnsafe(
        'UPDATE "BackgroundJob" SET status = $1 WHERE id = $2', 'UNKNOWN', job.id,
      )).rejects.toThrow();
    } finally {
      await db.backgroundJob.deleteMany({ where: { id: job.id } });
      await db.user.deleteMany({ where: { id: user.id } });
    }
  });

  it('拥有书籍的账号不能被直接删除', async () => {
    const suffix = crypto.randomUUID();
    const user = await db.user.create({ data: {
      email: `${suffix}@example.com`,
      emailNormalized: `${suffix}@example.com`,
      name: '所有权测试用户',
      passwordHash: 'scrypt$00$00',
      status: 'ACTIVE',
      shareCodeHash: crypto.createHash('sha256').update(suffix).digest('hex'),
    } });
    const book = await db.book.create({ data: {
      title: '测试书籍', filePath: 'tests/book.txt', fileSize: 1,
      mimeType: 'text/plain', userId: user.id,
    } });
    try {
      await expect(db.user.delete({ where: { id: user.id } }))
        .rejects.toMatchObject({ code: 'P2003' });
    } finally {
      await db.book.deleteMany({ where: { id: book.id } });
      await db.user.deleteMany({ where: { id: user.id } });
    }
  });

  it('baseline migration 中两个状态约束各出现一次', async () => {
    const sql = await readFile(new URL(
      '../prisma/migrations/20260715_postgresql_baseline/migration.sql',
      import.meta.url,
    ), 'utf8');
    expect(sql.match(/User_status_check/g)).toHaveLength(1);
    expect(sql.match(/BackgroundJob_status_check/g)).toHaveLength(1);
  });

  it('阶段二 migration 中快照与对象状态约束各出现一次', async () => {
    const sql = await readFile(new URL(
      '../prisma/migrations/20260719000000_phase2_objects_snapshots/migration.sql',
      import.meta.url,
    ), 'utf8');
    expect(sql.match(/AssetSnapshot_status_check/g)).toHaveLength(1);
    expect(sql.match(/SnapshotObject_state_check/g)).toHaveLength(1);
  });

  it('阶段三 migration 中 BookShare 状态约束出现一次', async () => {
    const sql = await readFile(new URL(
      '../prisma/migrations/20260719000001_phase3_book_shares/migration.sql',
      import.meta.url,
    ), 'utf8');
    expect(sql.match(/BookShare_status_check/g)).toHaveLength(1);
  });

  it('资产快照与对象状态 CHECK 拒绝未知值', async () => {
    const suffix = crypto.randomUUID();
    const user = await db.user.create({ data: {
      email: `${suffix}@example.com`,
      emailNormalized: `${suffix}@example.com`,
      name: '快照状态测试',
      passwordHash: 'scrypt$00$00',
      status: 'ACTIVE',
      shareCodeHash: crypto.createHash('sha256').update(suffix).digest('hex'),
    } });
    const book = await db.book.create({ data: {
      title: '快照状态书', filePath: 'tests/book.txt', fileSize: 1, userId: user.id,
    } });
    const snapshot = await db.assetSnapshot.create({ data: {
      bookId: book.id, ownerId: user.id, version: 1, contentRevision: suffix, status: 'building',
    } });
    const object = await db.assetObject.create({ data: {
      sha256: crypto.createHash('sha256').update(suffix).digest('hex'),
      bytes: BigInt(1), mime: 'text/plain', objectKey: `obj/aa/bb/${suffix.slice(0, 8)}`,
    } });
    const snapshotObject = await db.snapshotObject.create({ data: {
      snapshotId: snapshot.id, objectId: object.id, logicalPath: 'a.txt', category: 'source', state: 'present',
    } });
    try {
      await expect(db.$executeRawUnsafe(
        'UPDATE "AssetSnapshot" SET status = $1 WHERE id = $2', 'UNKNOWN', snapshot.id,
      )).rejects.toThrow();
      await expect(db.$executeRawUnsafe(
        'UPDATE "SnapshotObject" SET state = $1 WHERE id = $2', 'UNKNOWN', snapshotObject.id,
      )).rejects.toThrow();
    } finally {
      await db.snapshotObject.deleteMany({ where: { id: snapshotObject.id } });
      await db.assetSnapshot.deleteMany({ where: { id: snapshot.id } });
      await db.assetObject.deleteMany({ where: { id: object.id } });
      await db.book.deleteMany({ where: { id: book.id } });
      await db.user.deleteMany({ where: { id: user.id } });
    }
  });

  it('正式迁移 deploy 和 status 在已建空库上均成功', async () => {
    const options = {
      cwd: fileURLToPath(new URL('../../', import.meta.url)),
      env: process.env,
      windowsHide: true,
    };
    const deploy = await execAsync(
      'pnpm --filter @novel-agent/storage exec prisma migrate deploy --schema=./prisma/schema.prisma',
      options,
    );
    expect(deploy.stdout).toContain('No pending migrations to apply');

    const status = await execAsync(
      'pnpm --filter @novel-agent/storage exec prisma migrate status --schema=./prisma/schema.prisma',
      options,
    );
    expect(status.stdout).toContain('Database schema is up to date');
  }, 20_000);
});
