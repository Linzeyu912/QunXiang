/**
 * 分享复制到我的书库（阶段三 E1）。
 *
 * 接收方把分享指向的快照（含 manifest 与 archive 包）整体复制到自己的书库：
 *   - 新建一本目标 Book（带 sourceBookId/sourceShareId 溯源）；
 *   - 新建一条目标 AssetSnapshot（version=1、归属接收方、复用原 manifest/archive 对象键）；
 *   - 把源快照的全部 SnapshotObject 行复制到目标快照，**同一 objectId 复用底层 AssetObject**（不复制字节）；
 *   - 原子置目标 Book.currentSnapshotId（原生 SQL，不刷 updatedAt）。
 *
 * 状态机（全部状态转移在**同一 prisma.$transaction** 内，消除"事务提交后 markCopied 前崩溃"的窗口）：
 *   active →(事务内 markCopying 条件)→ copying →(同事务 markCopied)→ copied
 *   copying 分支（之前 attempt 崩溃）→ 事务内查重自愈（已建目标则补 markCopied，未建则续建）
 *   事务失败 → 自动回滚目标记录 + catch 内 markFailed(copying→active) 恢复 share
 *   撤销竞态：markCopying 条件失败 → noop（撤销优先）
 */
import {
  AssetSnapshotRepository,
  AuditLogRepository,
  BookShareRepository,
  SnapshotObjectRepository,
  prisma,
} from '@qunxiang/storage';

export interface CopyShareInput {
  shareId: string;
  recipientId: string;
  now?: Date;
}

export interface CopyShareResult {
  targetBookId?: string;
  /** markCopying 条件失败（撤销竞态）时返回 true，调用方视作成功 no-op。 */
  noop?: boolean;
}

export async function copyShareToLibrary(input: CopyShareInput): Promise<CopyShareResult> {
  const { shareId, recipientId } = input;
  const now = input.now ?? new Date();

  const share = await BookShareRepository.findForRecipient(shareId, recipientId);
  if (!share || share.status === 'revoked') {
    throw new Error('分享不存在或不可复制');
  }

  if (share.status === 'copied') {
    const targetBook = await prisma.book.findFirst({
      where: { sourceShareId: shareId, userId: recipientId },
      select: { id: true },
    });
    return { targetBookId: targetBook?.id };
  }

  // active → markCopying（撤销竞态 → noop）；copying → 之前 attempt 在途/崩溃，由事务内查重自愈
  if (share.status === 'active') {
    const claimed = await BookShareRepository.markCopying(shareId, recipientId, share.snapshotId, now);
    if (!claimed) return { noop: true };
  }

  try {
    const sourceSnapshot = await AssetSnapshotRepository.findOwnedById(share.snapshotId, share.senderId);
    if (!sourceSnapshot || sourceSnapshot.status !== 'ready') {
      throw new Error('源快照尚未就绪，无法复制');
    }
    const manifestObjectId = sourceSnapshot.manifestObjectId;
    const archiveObjectId = sourceSnapshot.archiveObjectId;
    if (!manifestObjectId || !archiveObjectId) {
      throw new Error('源快照缺少清单或归档对象，无法复制');
    }

    const sourceBook = await prisma.book.findUnique({
      where: { id: share.bookId },
      select: { title: true },
    });
    if (!sourceBook) {
      throw new Error('源书籍已被删除，无法复制');
    }

    const sourceItems = await SnapshotObjectRepository.listForSnapshot(sourceSnapshot.id);

    const targetBookId = await prisma.$transaction(async (tx) => {
      // 自愈：之前 attempt 事务可能已建目标但未 markCopied（现已并入事务，此处仍防御并发/历史数据）
      const existing = await tx.book.findFirst({
        where: { sourceShareId: shareId, userId: recipientId },
        select: { id: true },
      });
      if (existing) {
        await tx.bookShare.updateMany({
          where: { id: shareId, recipientId, status: 'copying' },
          data: { status: 'copied', copiedAt: now, failureReason: null },
        });
        return existing.id;
      }

      const targetBook = await tx.book.create({
        data: {
          title: sourceBook.title,
          filePath: '',
          fileSize: 0,
          mimeType: 'text/plain',
          userId: recipientId,
          sourceBookId: share.bookId,
          sourceShareId: shareId,
        },
      });

      const targetSnapshot = await tx.assetSnapshot.create({
        data: {
          bookId: targetBook.id,
          ownerId: recipientId,
          version: 1,
          contentRevision: sourceSnapshot.contentRevision,
          status: 'building',
        },
      });

      for (const item of sourceItems) {
        await tx.snapshotObject.create({
          data: {
            snapshotId: targetSnapshot.id,
            objectId: item.objectId,
            logicalPath: item.logicalPath,
            category: item.category,
            state: item.state,
            reason: item.reason ?? null,
          },
        });
      }

      await tx.assetSnapshot.update({
        where: { id: targetSnapshot.id },
        data: {
          status: 'ready',
          manifestObjectId,
          archiveObjectId,
          readyAt: now,
        },
      });

      await tx.$executeRaw`UPDATE "Book" SET "currentSnapshotId" = ${targetSnapshot.id}::uuid WHERE id = ${targetBook.id}::uuid`;

      // markCopied 并入事务：copying→copied 与目标记录原子提交，消除崩溃窗口（P0-2/P0-3）
      await tx.bookShare.updateMany({
        where: { id: shareId, recipientId, status: 'copying' },
        data: { status: 'copied', copiedAt: now, failureReason: null },
      });

      return targetBook.id;
    });

    await AuditLogRepository.create({
      actorType: 'USER',
      actorId: recipientId,
      action: 'BOOK_SHARE_COPIED',
      targetType: 'BOOK_SHARE',
      targetId: shareId,
      metadata: {
        sourceBookId: share.bookId,
        targetBookId,
        sourceSnapshotId: sourceSnapshot.id,
        manifestObjectId,
        archiveObjectId,
      },
    });

    return { targetBookId };
  } catch (err) {
    const reason = err instanceof Error ? err.message : '复制过程失败';
    try {
      await BookShareRepository.markFailed(shareId, reason, now);
      await AuditLogRepository.create({
        actorType: 'USER',
        actorId: recipientId,
        action: 'BOOK_SHARE_COPY_FAILED',
        targetType: 'BOOK_SHARE',
        targetId: shareId,
        metadata: { sourceBookId: share.bookId, reason },
      });
    } catch {
      // markFailed / 审计失败不掩盖原始错误
    }
    throw err;
  }
}
