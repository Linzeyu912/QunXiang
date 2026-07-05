import { Prisma, prisma, UserRepository } from '@novel-agent/storage';
import { hashPassword } from './password.js';

/**
 * 本地单机默认账号：开机自动登录用。密码固定且公开，仅作本地占位，
 * 不构成任何安全边界——真正的鉴权底层（JWT / userId 贯穿仓储）原样保留，
 * 以后要做多用户时这套默认账号机制可直接停用，无需改仓储层。
 */
export const DEFAULT_USER = {
  email: 'test@example.com',
  name: 'test',
  password: 'example',
} as const;

/**
 * 启动期确保默认用户存在，前端开机即可静默自动登录，不再出现登录页。
 *
 * 落地策略（本地单机，目标是一个默认账号、保留其名下数据）：
 * - 空库：创建默认用户；
 * - 非空库：挑出"持书用户"（名下有 Book 的用户）改造为默认账号，书库原样保留；
 *   其余空壳账号删除——它们不持有任何数据，删了不影响书库。
 *   若没有任何用户持书，则把第一个用户改造为默认账号。
 *
 * 改造时的唯一约束冲突场景（换机后登录失败的常见来源）：当持书用户 email 与
 * 默认邮箱不同，而库里又恰好存在一个 test@example.com 的空壳账号时，直接 update
 * 持书用户的 email 会触发唯一约束报错。本实现先把冲突的空壳默认账号删掉再改造，
 * 并用事务包裹，同时在每一步打印日志，便于部署排查。
 * 失败仅抛出由调用方决定是否阻塞启动。
 */
export async function ensureDefaultUser(): Promise<void> {
  const passwordHash = await hashPassword(DEFAULT_USER.password);

  if ((await prisma.user.count()) === 0) {
    console.log('[defaultUser] 空库，创建默认账号 test@example.com');
    await UserRepository.create({
      email: DEFAULT_USER.email,
      name: DEFAULT_USER.name,
      passwordHash,
    });
    return;
  }

  // 挑改造目标：优先持书用户（保数据），否则退回第一个用户。
  const bookOwners = await prisma.user.findMany({
    where: { books: { some: {} } },
  });
  const target =
    bookOwners.length > 0 ? bookOwners[0] : await prisma.user.findFirst();
  if (!target) {
    console.warn('[defaultUser] 库非空但找不到任何用户，跳过');
    return;
  }

  // 是否已存在占用默认邮箱的账号（可能与 target 不同）。
  const existingDefault = await UserRepository.findByEmail(DEFAULT_USER.email);

  await prisma.$transaction(async (tx) => {
    // 情况一：target 本身就是默认邮箱账号 → 直接刷新密码/名称即可。
    if (target.email === DEFAULT_USER.email) {
      console.log(`[defaultUser] 目标已是默认邮箱，刷新密码 (id=${target.id})`);
      await tx.user.update({
        where: { id: target.id },
        data: { name: DEFAULT_USER.name, passwordHash },
      });
      await deleteStrayUsers(tx, target.id);
      return;
    }

    // 情况二：target 不是默认邮箱，但存在一个占用了默认邮箱的其它账号。
    if (existingDefault) {
      const occupierOwnsBooks = await tx.book.count({ where: { userId: existingDefault.id } });
      if (occupierOwnsBooks > 0) {
        // 占用者持书，它才是真正该保留的默认账号——刷新它的密码，target 视作空壳清理。
        console.log(`[defaultUser] 默认邮箱已被持书用户占用，刷新其密码 (id=${existingDefault.id})`);
        await tx.user.update({
          where: { id: existingDefault.id },
          data: { name: DEFAULT_USER.name, passwordHash },
        });
        await deleteStrayUsers(tx, existingDefault.id);
        return;
      }
      // 占用者是空壳，删除以释放默认邮箱，避免唯一约束冲突。
      console.log(`[defaultUser] 删除占用默认邮箱的空壳账号 (id=${existingDefault.id})`);
      await tx.user.delete({ where: { id: existingDefault.id } });
    }

    // 删除所有非 target 的空壳账号。
    await deleteStrayUsers(tx, target.id);

    // 把 target 改造成默认账号。
    console.log(`[defaultUser] 改造目标为默认账号 (id=${target.id}, 旧邮箱=${target.email})`);
    await tx.user.update({
      where: { id: target.id },
      data: {
        email: DEFAULT_USER.email,
        name: DEFAULT_USER.name,
        passwordHash,
      },
    });
  });
}

/**
 * 删除所有非 keepId 的空壳账号（不持书的）。
 * 关键：只删 books 为空的账号，绝不删持书账号，避免误删他人书库数据。
 * （原实现会删所有非 target 账号，多持书用户场景下有数据丢失风险。）
 */
async function deleteStrayUsers(tx: Prisma.TransactionClient, keepId: string): Promise<void> {
  const allUsers = await tx.user.findMany({ select: { id: true, email: true } });
  const strayIds = allUsers.filter((u) => u.id !== keepId).map((u) => u.id);
  if (strayIds.length === 0) return;
  const res = await tx.user.deleteMany({
    where: { id: { in: strayIds }, books: { none: {} } },
  });
  if (res.count > 0) {
    console.log(`[defaultUser] 清理了 ${res.count} 个空壳账号`);
  }
}
