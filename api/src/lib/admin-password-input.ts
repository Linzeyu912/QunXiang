export function parseResetPasswordArgs(args: string[]): string {
  const [email, mode, ...extra] = args;
  if (!email || mode !== '--password-stdin' || extra.length > 0) {
    throw new Error(
      '新密码不得作为命令行参数。用法：admin:reset-password -- <邮箱> --password-stdin',
    );
  }
  return email;
}

export async function readPasswordFromStdin(
  input: AsyncIterable<string | Buffer>,
): Promise<string> {
  let value = '';
  for await (const chunk of input) value += chunk.toString();
  const password = value.replace(/[\r\n]+$/, '');
  if (!password) throw new Error('标准输入中没有新密码');
  return password;
}
