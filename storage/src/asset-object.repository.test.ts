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
  const user = await testPrisma.user.create({ data: testUserInput(`obj-${randomUUID()}@test`) });
  const book = await testPrisma.book.create({
    data: { title: '对象测试书', filePath: '/tmp/book.txt', fileSize: 1, userId: user.id },
  });
  return { user, book };
}

describe('AssetObjectRepository', () => {
  afterEach(async () => {
    await testPrisma.snapshotObject.deleteMany();
    await testPrisma.assetSnapshot.deleteMany();
    await testPrisma.assetObject.deleteMany();
    await testPrisma.book.deleteMany();
    await testPrisma.user.deleteMany();
  });

  afterAll(cleanupTestDb);

  it('putIfAbsent 按 objectKey 去重且不覆盖', async () => {
    const first = await objects.putIfAbsent({
      sha256: sha('a'), bytes: BigInt(10), mime: 'text/plain', objectKey: 'obj/aa/bb/key1', etag: 'e1',
    });
    const second = await objects.putIfAbsent({
      sha256: sha('a'), bytes: BigInt(10), mime: 'text/plain', objectKey: 'obj/aa/bb/key1', etag: 'e2',
    });
    expect(second.id).toBe(first.id);
    expect(second.etag).toBe('e1');
  });

  it('countReferences 合并 SnapshotObject、manifest、archive 引用', async () => {
    const { book, user } = await seedBook();
    const obj = await objects.putIfAbsent({
      sha256: sha('b'), bytes: BigInt(5), mime: 'text/plain', objectKey: 'obj/aa/bb/ref',
    });
    const snap = await snapshots.create({ bookId: book.id, ownerId: user.id, contentRevision: 'rev1' });
    await testPrisma.snapshotObject.create({
      data: { snapshotId: snap.id, objectId: obj.id, logicalPath: 'source/x.txt', category: 'source', state: 'present' },
    });
    expect(await objects.countReferences(obj.id)).toBe(1);
  });

  it('deleteIfUnreferenced 无引用时删除并返回 true', async () => {
    const obj = await objects.putIfAbsent({
      sha256: sha('c'), bytes: BigInt(3), mime: 'text/plain', objectKey: 'obj/aa/bb/del',
    });
    expect(await objects.deleteIfUnreferenced(obj.id)).toBe(true);
    expect(await objects.findById(obj.id)).toBeNull();
  });

  it('deleteIfUnreferenced 有引用时不删除并返回 false', async () => {
    const { book, user } = await seedBook();
    const obj = await objects.putIfAbsent({
      sha256: sha('d'), bytes: BigInt(3), mime: 'text/plain', objectKey: 'obj/aa/bb/keep',
    });
    const snap = await snapshots.create({ bookId: book.id, ownerId: user.id, contentRevision: 'rev1' });
    await testPrisma.snapshotObject.create({
      data: { snapshotId: snap.id, objectId: obj.id, logicalPath: 'a', category: 'source', state: 'present' },
    });
    expect(await objects.deleteIfUnreferenced(obj.id)).toBe(false);
    expect(await objects.findById(obj.id)).not.toBeNull();
  });
});
