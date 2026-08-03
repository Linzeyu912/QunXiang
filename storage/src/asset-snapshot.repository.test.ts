import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { createAssetObjectRepository } from './asset-object.repository.js';
import { createAssetSnapshotRepository } from './asset-snapshot.repository.js';
import { cleanupTestDb, testPrisma } from './test-setup.js';
import { testUserInput } from './test-fixtures.js';

const objects = createAssetObjectRepository(testPrisma);
const snapshots = createAssetSnapshotRepository(testPrisma);

function sha(label: string): string {
  return createHash('sha256').update(`${label}:${randomUUID()}`).digest('hex');
}

async function seedBook() {
  const user = await testPrisma.user.create({ data: testUserInput(`snap-${randomUUID()}@test`) });
  const book = await testPrisma.book.create({
    data: { title: '快照测试书', filePath: '/tmp/book.txt', fileSize: 1, userId: user.id },
  });
  return { user, book };
}

describe('AssetSnapshotRepository', () => {
  afterEach(async () => {
    await testPrisma.snapshotObject.deleteMany();
    await testPrisma.assetSnapshot.deleteMany();
    await testPrisma.assetObject.deleteMany();
    await testPrisma.book.deleteMany();
    await testPrisma.user.deleteMany();
  });

  afterAll(cleanupTestDb);

  it('create 自增版本号并默认 building', async () => {
    const { book, user } = await seedBook();
    const a = await snapshots.create({ bookId: book.id, ownerId: user.id, contentRevision: 'r1' });
    const b = await snapshots.create({ bookId: book.id, ownerId: user.id, contentRevision: 'r2' });
    expect(a.version).toBe(1);
    expect(b.version).toBe(2);
    expect(a.status).toBe('building');
    expect(b.status).toBe('building');
  });

  it('create 同 contentRevision 冲突抛中文错误', async () => {
    const { book, user } = await seedBook();
    await snapshots.create({ bookId: book.id, ownerId: user.id, contentRevision: 'dup' });
    await expect(
      snapshots.create({ bookId: book.id, ownerId: user.id, contentRevision: 'dup' }),
    ).rejects.toThrow('该成果版本已存在快照');
  });

  it('markReady 仅从 building 转 ready 并写 manifestObjectId', async () => {
    const { book, user } = await seedBook();
    const snap = await snapshots.create({ bookId: book.id, ownerId: user.id, contentRevision: 'r' });
    const manifest = await objects.putIfAbsent({
      sha256: sha('m'), bytes: BigInt(1), mime: 'application/json', objectKey: 'obj/aa/bb/m',
    });
    const ready = await snapshots.markReady(snap.id, manifest.id);
    expect(ready?.status).toBe('ready');
    expect(ready?.manifestObjectId).toBe(manifest.id);
    expect(ready?.readyAt).toBeTruthy();
    // 二次 markReady（非 building）返回 null
    expect(await snapshots.markReady(snap.id, manifest.id)).toBeNull();
  });

  it('markFailed 从 building 转 failed 并写原因', async () => {
    const { book, user } = await seedBook();
    const snap = await snapshots.create({ bookId: book.id, ownerId: user.id, contentRevision: 'r' });
    const failed = await snapshots.markFailed(snap.id, '对象存储暂时不可用');
    expect(failed?.status).toBe('failed');
    expect(failed?.failureReason).toBe('对象存储暂时不可用');
  });

  it('markArchived 在 ready 后写 archiveObjectId，非 ready 返回 null', async () => {
    const { book, user } = await seedBook();
    const snap = await snapshots.create({ bookId: book.id, ownerId: user.id, contentRevision: 'r' });
    const archive = await objects.putIfAbsent({
      sha256: sha('z'), bytes: BigInt(2), mime: 'application/zip', objectKey: 'obj/aa/bb/z',
    });
    // building 状态下 markArchived 返回 null
    expect(await snapshots.markArchived(snap.id, archive.id)).toBeNull();
    const manifest = await objects.putIfAbsent({
      sha256: sha('m2'), bytes: BigInt(1), mime: 'application/json', objectKey: 'obj/aa/bb/m2',
    });
    await snapshots.markReady(snap.id, manifest.id);
    const archived = await snapshots.markArchived(snap.id, archive.id);
    expect(archived?.archiveObjectId).toBe(archive.id);
    expect(archived?.status).toBe('ready');
  });

  it('findOwnedById 拒绝错误 owner', async () => {
    const { book, user } = await seedBook();
    const snap = await snapshots.create({ bookId: book.id, ownerId: user.id, contentRevision: 'r' });
    expect(await snapshots.findOwnedById(snap.id, user.id)).not.toBeNull();
    expect(await snapshots.findOwnedById(snap.id, randomUUID())).toBeNull();
  });
});
