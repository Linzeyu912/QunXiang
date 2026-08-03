import 'dotenv/config';
import { closeDatabase } from '@novel-agent/storage';
import { resetUserPasswordByAdmin } from '../src/services/admin-account.service.js';
import {
  parseResetPasswordArgs,
  readPasswordFromStdin,
} from '../src/lib/admin-password-input.js';

async function main() {
  const email = parseResetPasswordArgs(process.argv.slice(2));
  const newPassword = await readPasswordFromStdin(process.stdin);

  const result = await resetUserPasswordByAdmin({
    email,
    newPassword,
    actorId: 'local-cli',
  });
  console.log(`密码已重置，已撤销 ${result.revokedSessionCount} 个登录会话。`);
}

main()
  .catch((error) => {
    console.error('管理员重置失败：', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase();
  });
