/**
 * 公共书库手动补跑：给已注册的老用户补发 seed-library/ 里的预置书籍。
 *
 * 注册钩子只覆盖新注册用户；本工具用于功能上线前已存在的账号。
 * 按书名去重——用户已有同名书则跳过，可安全重复执行。
 *
 * 用法：pnpm --filter @novel-agent/api seed:provision <email>
 */
import 'dotenv/config';
import { closeDatabase, prisma } from '@novel-agent/storage';
import { provisionSeedLibrary } from '../src/services/library-seed.service.js';

async function main() {
  const [email] = process.argv.slice(2);
  if (!email) {
    console.error('用法：pnpm --filter @novel-agent/api seed:provision <email>');
    process.exitCode = 1;
    return;
  }

  const user = await prisma.user.findFirst({
    where: { emailNormalized: email.trim().toLowerCase() },
  });
  if (!user) {
    console.error(`用户不存在：${email}`);
    process.exitCode = 1;
    return;
  }

  const result = await provisionSeedLibrary(user.id, { force: true });
  if (result.provisioned.length > 0) {
    console.log(`✓ 已为 ${user.email} 补发 ${result.provisioned.length} 本：${result.provisioned.join('、')}`);
  } else {
    console.log('无需补发（seed-library 为空，或同名书已存在）。');
  }
}

main()
  .catch((error) => {
    console.error('补跑失败：', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase();
  });
