import { prisma } from '@novel-agent/storage';
import { normalizeEmail } from '../lib/email.js';
import { hashPassword } from '../lib/password.js';

export interface ResetUserPasswordByAdminInput {
  email: string;
  newPassword: string;
  actorId?: string;
}

export interface ResetUserPasswordByAdminResult {
  userId: string;
  revokedSessionCount: number;
}

/**
 * 本机管理员密码重置。密码更新、会话撤销和审计写入在同一事务内完成。
 */
export async function resetUserPasswordByAdmin(
  input: ResetUserPasswordByAdminInput,
): Promise<ResetUserPasswordByAdminResult> {
  if (input.newPassword.length < 6) {
    throw new Error('新密码至少 6 位');
  }

  const emailNormalized = normalizeEmail(input.email);
  const passwordHash = await hashPassword(input.newPassword);
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { emailNormalized } });
    if (!user) {
      throw new Error('账号不存在');
    }

    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });
    const revoked = await tx.refreshSession.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: now },
    });
    await tx.auditLog.create({
      data: {
        actorType: 'LOCAL_ADMIN',
        actorId: input.actorId ?? null,
        action: 'ACCOUNT_PASSWORD_RESET',
        targetType: 'USER',
        targetId: user.id,
        metadata: {
          source: 'LOCAL_CLI',
          revokedSessionCount: revoked.count,
        },
      },
    });

    return { userId: user.id, revokedSessionCount: revoked.count };
  });
}
