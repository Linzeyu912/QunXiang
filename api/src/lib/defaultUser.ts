import { prisma, UserRepository } from '@novel-agent/storage';
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
 * 改造时若目标用户与默认邮箱冲突（库里已有 test@example.com），直接就地刷新其密码。
 * 失败仅抛出由调用方决定是否阻塞启动。
 */
export async function ensureDefaultUser(): Promise<void> {
  const passwordHash = await hashPassword(DEFAULT_USER.password);

  if ((await prisma.user.count()) === 0) {
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
  if (!target) return;

  // 删除所有"非目标"的空壳账号：它们不持书，删了不影响书库。
  // 用邮箱集合避免 SQL 关键字/占位符差异，空数组直接跳过。
  const allUsers = await prisma.user.findMany({ select: { id: true, email: true } });
  const strayIds = allUsers.filter((u) => u.id !== target.id).map((u) => u.id);
  if (strayIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: strayIds } } });
  }

  // 若改造目标的 email 已是默认邮箱 → 仅刷新密码/名称，避免触发唯一约束。
  if (target.email === DEFAULT_USER.email) {
    await prisma.user.update({
      where: { id: target.id },
      data: { name: DEFAULT_USER.name, passwordHash },
    });
    return;
  }

  await prisma.user.update({
    where: { id: target.id },
    data: {
      email: DEFAULT_USER.email,
      name: DEFAULT_USER.name,
      passwordHash,
    },
  });
}
