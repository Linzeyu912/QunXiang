import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { createAssetObjectRepository } from './asset-object.repository.js';
import { createAssetSnapshotRepository } from './asset-snapshot.repository.js';
import { createSnapshotObjectRepository } from './snapshot-object.repository.js';
import { cleanupTestDb, testPrisma } from './test-setup.js';
import { testUserInput } from './test-fixtures.js';

const objects = createAssetObjectRepository(testPrisma);
const snapshots = createAssetSnapshotRepository(testPrisma);
const snapshotObjects = createSnapshotObjectRepository(testPrisma);

function sha(label: string): string {
  return createHash('sha256').update(`${label}:${randomUUID()}`).digest('hex');
}

async function seedSnapshot() {
  const user = await testPrisma.user.create({ data: testUserInput(`so-${randomUUID()}@test`) });
  const book = await testPrisma.book.create({
    data: { title: '快照对象测试书', filePath: '/tmp/book.txt', fileSize: 1, userId: user.id },
  });
  const snap = await snapshots.create({ bookId: book.id, ownerId: user.id, contentRevision: 'r' });
  return { user, book, snap };
}

describe('SnapshotObjectRepository', () => {
  afterEach(async () => {
    await testPrisma.snapshotObject.deleteMany();
    await testPrisma.assetSnapshot.deleteMany();
    await testPrisma.assetObject.deleteMany();
    await testPrisma.book.deleteMany();
    await testPrisma.user.deleteMany();
  });

  afterAll(cleanupTestDb);

  it('bulkCreate 写入并按 logicalPath 排序列出', async () => {
    const { snap } = await seedSnapshot();
    const o1 = await objects.putIfAbsent({ sha256: sha('1'), bytes: BigInt(1), mime: 'text/plain', objectKey: 'obj/aa/bb/1' });
    const o2 = await objects.putIfAbsent({ sha256: sha('2'), bytes: BigInt(1), mime: 'text/plain', objectKey: 'obj/aa/bb/2' });
    await snapshotObjects.bulkCreate(snap.id, [
      { objectId: o1.id, logicalPath: 'source/b.txt', category: 'source', state: 'present' },
      { objectId: o2.id, logicalPath: 'source/a.txt', category: 'source', state: 'present' },
    ]);
    const list = await snapshotObjects.listForSnapshot(snap.id);
    expect(list.map((r) => r.logicalPath)).toEqual(['source/a.txt', 'source/b.txt']);
  });

  it('bulkCreate 同快照重复 logicalPath 抛唯一约束错误', async () => {
    const { snap } = await seedSnapshot();
    const o = await objects.putIfAbsent({ sha256: sha('d'), bytes: BigInt(1), mime: 'text/plain', objectKey: 'obj/aa/bb/d' });
    await snapshotObjects.bulkCreate(snap.id, [
      { objectId: o.id, logicalPath: 'dup.txt', category: 'source', state: 'present' },
    ]);
    await expect(
      snapshotObjects.bulkCreate(snap.id, [
        { objectId: o.id, logicalPath: 'dup.txt', category: 'source', state: 'present' },
      ]),
    ).rejects.toThrow();
  });

  it('countByObject 统计对象被快照引用次数', async () => {
    const { snap } = await seedSnapshot();
    const o = await objects.putIfAbsent({ sha256: sha('c'), bytes: BigInt(1), mime: 'text/plain', objectKey: 'obj/aa/bb/c' });
    await snapshotObjects.bulkCreate(snap.id, [
      { objectId: o.id, logicalPath: 'a.txt', category: 'source', state: 'present' },
    ]);
    expect(await snapshotObjects.countByObject(o.id)).toBe(1);
  });
});
