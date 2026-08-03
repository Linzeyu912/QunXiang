import crypto from 'node:crypto';

export function testUserInput(email: string, name = '测试用户') {
  return {
    email,
    emailNormalized: email.trim().toLowerCase(),
    name,
    passwordHash: `scrypt$00112233445566778899aabbccddeeff$${'00'.repeat(64)}`,
    shareCodeHash: crypto.createHash('sha256').update(email).digest('hex'),
    status: 'ACTIVE' as const,
  };
}
