import { describe, expect, it, vi } from 'vitest';
import { verifyLoginCredentials } from './login-credentials.js';

describe('登录密码校验路径', () => {
  it('未知邮箱和已注册邮箱都执行一次密码哈希校验', async () => {
    const verify = vi.fn().mockResolvedValue(false);
    await expect(verifyLoginCredentials(null, '尝试密码', verify)).resolves.toBe(false);
    expect(verify).toHaveBeenCalledTimes(1);
    expect(verify.mock.calls[0][1]).toMatch(/^scrypt\$/);

    verify.mockClear();
    await expect(verifyLoginCredentials(
      { passwordHash: 'scrypt$stored$hash' },
      '尝试密码',
      verify,
    )).resolves.toBe(false);
    expect(verify).toHaveBeenCalledTimes(1);
    expect(verify).toHaveBeenCalledWith('尝试密码', 'scrypt$stored$hash');
  });
});
