import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { parseResetPasswordArgs, readPasswordFromStdin } from './admin-password-input.js';

describe('管理员密码标准输入', () => {
  it('命令行只接受邮箱和 --password-stdin，不接受明文密码参数', () => {
    expect(parseResetPasswordArgs(['user@example.com', '--password-stdin']))
      .toBe('user@example.com');
    expect(() => parseResetPasswordArgs(['user@example.com', '明文密码123']))
      .toThrow('新密码不得作为命令行参数');
  });

  it('从标准输入读取并移除末尾换行', async () => {
    await expect(readPasswordFromStdin(Readable.from(['安全新密码123\r\n'])))
      .resolves.toBe('安全新密码123');
  });
});
