/**
 * 分享业务服务（阶段三 D2）。
 *
 * 所有者把当前 ready 快照分享给已注册账号：邮箱 + 不可猜测分享码双重确认，
 * 失败统一中文（避免枚举注册邮箱）；接收方查看脱敏摘要；发送者撤销。
 * 签名 URL/对象键不入库不入日志；审计记录创建/撤销。
 */
import {
  AuditLogRepository,
  AssetSnapshotRepository,
  BackgroundJobRepository,
  BookShareRepository,
  UserRepository,
  prisma,
} from '@novel-agent/storage';
import { normalizeEmail } from '../lib/email.js';
import { verifyShareCode } from '../lib/share-code.js';

const SHARE_FAIL_MSG = '无法分享给该账号，请核对邮箱和分享码';
const SHARE_NOT_COPYABLE_MSG = '分享不存在或不可复制';

/** 分享失败（邮箱/码/账号问题）统一抛此错误，路由映射为 400 + 固定中文。 */
export class ShareError extends Error {
  constructor(message: string = SHARE_FAIL_MSG) {
    super(message);
    this.name = 'ShareError';
  }
}

/** 复制分享相关失败（不存在/已撤销），路由映射为 404/400。 */
export class ShareCopyError extends Error {
  constructor(message: string = SHARE_NOT_COPYABLE_MSG) {
    super(message);
    this.name = 'ShareCopyError';
  }
}

export interface CreateShareInput {
  recipientEmail: string;
  recipientShareCode: string;
}

export interface ShareServiceBook {
  id: string;
  title: string;
}

/**
 * 创建分享：邮箱规范化 → 查接收账号 → 校验 ACTIVE → 恒定时间校验分享码
 * → 禁止分享给自己 → 锁定当前 ready 且已打包快照 → 复用/新建分享 + 审计。
 * 邮箱与分享码必然指向同一账号（按 emailNormalized 唯一查得）。
 */
export async function createShare(book: ShareServiceBook, senderId: string, input: CreateShareInput) {
  const normalized = normalizeEmail(input.recipientEmail);
  const recipient = await UserRepository.findByEmail(normalized);
  // 用户不存在时也跑一次 verifyShareCode（dummy hash），拉平时序避免邮箱枚举（P1-4）
  const expectedHash = recipient?.shareCodeHash ?? '0'.repeat(64);
  const codeOk = verifyShareCode(input.recipientShareCode, expectedHash);
  if (!recipient || recipient.status !== 'ACTIVE' || !codeOk) throw new ShareError();
  if (recipient.id === senderId) throw new ShareError();

  const snapshot = await AssetSnapshotRepository.findCurrentForBook(book.id, senderId);
  if (!snapshot || snapshot.status !== 'ready' || !snapshot.archiveObjectId) {
    throw new Error('该书籍尚无可分享的完整数据包');
  }

  const share = await BookShareRepository.create({
    bookId: book.id,
    snapshotId: snapshot.id,
    senderId,
    recipientId: recipient.id,
  });

  await AuditLogRepository.create({
    actorType: 'USER',
    actorId: senderId,
    action: 'BOOK_SHARE_CREATED',
    targetType: 'BOOK_SHARE',
    targetId: share.id,
    metadata: { bookId: book.id, recipientId: recipient.id, snapshotId: snapshot.id },
  });

  return share;
}

export interface SharedWithMeItem {
  shareId: string;
  bookId: string;
  bookTitle: string;
  senderId: string;
  senderName: string;
  status: string;
  snapshotVersion: number;
  sharedAt: string;
}

/** 接收方视角摘要（脱敏：书名、发送者显示名、状态、版本、时间；不含对象键/签名）。 */
export async function listSharedWithMe(recipientId: string): Promise<SharedWithMeItem[]> {
  const shares = await BookShareRepository.findSharedWithMe(recipientId);
  // BookShare.senderId 是裸列（无关系），按需批量查发送者显示名
  const senderIds = [...new Set(shares.map((s) => s.senderId))];
  const senders = await Promise.all(senderIds.map((id) => UserRepository.findById(id)));
  const senderMap = new Map(senders.filter(Boolean).map((u) => [u!.id, u!.name]));
  return shares.map((s) => {
    const row = s as typeof s & { book?: { title?: string }; snapshot?: { version?: number } };
    return {
      shareId: s.id,
      bookId: s.bookId,
      bookTitle: row.book?.title ?? '',
      senderId: s.senderId,
      senderName: senderMap.get(s.senderId) ?? '',
      status: s.status,
      snapshotVersion: row.snapshot?.version ?? 0,
      sharedAt: s.createdAt.toISOString(),
    };
  });
}

/** 发送者撤销分享（active→revoked）。不存在/非本人/非 active 返回 false。 */
export async function revokeShare(shareId: string, senderId: string): Promise<boolean> {
  const revoked = await BookShareRepository.revoke(shareId, senderId);
  if (revoked) {
    await AuditLogRepository.create({
      actorType: 'USER',
      actorId: senderId,
      action: 'BOOK_SHARE_REVOKED',
      targetType: 'BOOK_SHARE',
      targetId: shareId,
      metadata: {},
    });
    return true;
  }
  return false;
}

export interface RequestCopyResult {
  /** copying：已入队后台复制任务；copied：此前已复制完成（幂等）。 */
  state: 'copying' | 'copied';
  /** 已复制时附带目标书 id（按 sourceShareId+接收方查回）。 */
  targetBookId?: string;
}

/**
 * 接收方请求把分享复制到自己的书库（阶段三 E1b）。
 *
 * 校验：不存在/已撤销 → 抛 ShareCopyError 中文（路由映射 404/400）；
 * 已 copied → 幂等返回目标书 id；active/copying → 入队 book-copy 任务（reactivate 幂等重投）。
 */
export async function requestCopy(shareId: string, recipientId: string): Promise<RequestCopyResult> {
  const share = await BookShareRepository.findForRecipient(shareId, recipientId);
  if (!share || share.status === 'revoked') {
    throw new ShareCopyError();
  }
  if (share.status === 'copied') {
    const targetBook = await prisma.book.findFirst({
      where: { sourceShareId: shareId, userId: recipientId },
      select: { id: true },
    });
    return { state: 'copied', targetBookId: targetBook?.id };
  }
  await BackgroundJobRepository.enqueue({
    kind: 'book-copy',
    uniqueKey: `${shareId}:${recipientId}:book-copy`,
    payload: { shareId, recipientId },
    // 已 failed/succeeded 同键任务重置为 pending，保证接收方可重复点击触发重试
    reactivate: true,
  });
  return { state: 'copying' };
}
