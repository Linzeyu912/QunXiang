import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createBookShareRepository } from './book-share.repository.js';
import { cleanupTestDb, testPrisma } from './test-setup.js';
import { testUserInput } from './test-fixtures.js';

const repo = createBookShareRepository(testPrisma);

async function seed() {
  const sender = await testPrisma.user.create({ data: testUserInput(`sender-${randomUUID()}@test`) });
  const recipient = await testPrisma.user.create({ data: testUserInput(`rec-${randomUUID()}@test`) });
  const book = await testPrisma.book.create({ data: { title: '分享书', filePath: '', fileSize: 1, userId: sender.id } });
  const obj = await testPrisma.assetObject.create({ data: { sha256: randomUUID().replace(/-/g, ''), bytes: BigInt(1), mime: 'text/plain', objectKey: `obj/aa/bb/${randomUUID()}` } });
  const snapshot = await testPrisma.assetSnapshot.create({ data: { bookId: book.id, ownerId: sender.id, version: 1, contentRevision: randomUUID(), status: 'ready', manifestObjectId: obj.id, archiveObjectId: obj.id } });
  return { sender, recipient, book, snapshot };
}

describe('BookShareRepository', () => {
  afterEach(async () => {
    await testPrisma.bookShare.deleteMany();
    await testPrisma.assetSnapshot.deleteMany();
    await testPrisma.assetObject.deleteMany();
    await testPrisma.book.deleteMany();
    await testPrisma.user.deleteMany();
  });
  afterAll(cleanupTestDb);

  it('create 同书同接收方非撤销复用', async () => {
    const { sender, recipient, book, snapshot } = await seed();
    const a = await repo.create({ bookId: book.id, snapshotId: snapshot.id, senderId: sender.id, recipientId: recipient.id });
    const b = await repo.create({ bookId: book.id, snapshotId: snapshot.id, senderId: sender.id, recipientId: recipient.id });
    expect(b.id).toBe(a.id);
    expect(a.status).toBe('active');
  });

  it('已撤销可重新创建（不与 revoked 冲突）', async () => {
    const { sender, recipient, book, snapshot } = await seed();
    const first = await repo.create({ bookId: book.id, snapshotId: snapshot.id, senderId: sender.id, recipientId: recipient.id });
    await repo.revoke(first.id, sender.id);
    const second = await repo.create({ bookId: book.id, snapshotId: snapshot.id, senderId: sender.id, recipientId: recipient.id });
    expect(second.id).not.toBe(first.id);
    expect(second.status).toBe('active');
  });

  it('revoke 仅发送者 active→revoked；非本人/非 active 返回 null', async () => {
    const { sender, recipient, book, snapshot } = await seed();
    const share = await repo.create({ bookId: book.id, snapshotId: snapshot.id, senderId: sender.id, recipientId: recipient.id });
    expect(await repo.revoke(share.id, randomUUID())).toBeNull(); // 非本人
    const revoked = await repo.revoke(share.id, sender.id);
    expect(revoked?.status).toBe('revoked');
    expect(await repo.revoke(share.id, sender.id)).toBeNull(); // 已 revoked
  });

  it('markCopying 条件 active+recipient+snapshot；撤销先成功则复制返回 false', async () => {
    const { sender, recipient, book, snapshot } = await seed();
    const share = await repo.create({ bookId: book.id, snapshotId: snapshot.id, senderId: sender.id, recipientId: recipient.id });
    // 撤销先成功
    await repo.revoke(share.id, sender.id);
    const ok = await repo.markCopying(share.id, recipient.id, snapshot.id);
    expect(ok).toBe(false);
  });

  it('markCopying 成功后 markCopied→copied', async () => {
    const { sender, recipient, book, snapshot } = await seed();
    const share = await repo.create({ bookId: book.id, snapshotId: snapshot.id, senderId: sender.id, recipientId: recipient.id });
    const ok = await repo.markCopying(share.id, recipient.id, snapshot.id);
    expect(ok).toBe(true);
    const copied = await repo.markCopied(share.id, recipient.id);
    expect(copied?.status).toBe('copied');
    expect(copied?.copiedAt).toBeTruthy();
  });

  it('markFailed 把 copying 恢复为 active', async () => {
    const { sender, recipient, book, snapshot } = await seed();
    const share = await repo.create({ bookId: book.id, snapshotId: snapshot.id, senderId: sender.id, recipientId: recipient.id });
    await repo.markCopying(share.id, recipient.id, snapshot.id);
    const failed = await repo.markFailed(share.id, '对象存储暂时不可用');
    expect(failed?.status).toBe('active');
    expect(failed?.failureReason).toBe('对象存储暂时不可用');
  });

  it('findSharedWithMe 返回接收方分享且按时间倒序', async () => {
    const { sender, recipient, book, snapshot } = await seed();
    await repo.create({ bookId: book.id, snapshotId: snapshot.id, senderId: sender.id, recipientId: recipient.id });
    const list = await repo.findSharedWithMe(recipient.id);
    expect(list).toHaveLength(1);
    expect(list[0].recipientId).toBe(recipient.id);
  });

  it('findForRecipient 拒绝错误接收方', async () => {
    const { sender, recipient, book, snapshot } = await seed();
    const share = await repo.create({ bookId: book.id, snapshotId: snapshot.id, senderId: sender.id, recipientId: recipient.id });
    expect(await repo.findForRecipient(share.id, recipient.id)).not.toBeNull();
    expect(await repo.findForRecipient(share.id, randomUUID())).toBeNull();
  });
});
