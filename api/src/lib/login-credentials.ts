import { verifyPassword } from './password.js';

type PasswordVerifier = (plain: string, stored: string) => Promise<boolean>;

// 固定占位哈希让未知邮箱与已注册邮箱都执行一次相同成本的 scrypt，降低计时枚举风险。
const DUMMY_PASSWORD_HASH =
  'scrypt$8f37658d5e08b2d5199d11630498dc7a$' +
  'b2d3863cb1c2bf01f165ba50d262a5a35bbcafebd7743a29be79415ef5e9c08a' +
  '5e1cad486cc7b7717fe67f375b48fe413657a6d7a874b1c8e35a11f0967e068e';

export async function verifyLoginCredentials(
  user: { passwordHash: string } | null,
  plainPassword: string,
  verify: PasswordVerifier = verifyPassword,
): Promise<boolean> {
  const passwordMatches = await verify(
    plainPassword,
    user?.passwordHash ?? DUMMY_PASSWORD_HASH,
  );
  return user !== null && passwordMatches;
}
