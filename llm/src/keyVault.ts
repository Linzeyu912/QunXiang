import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

/**
 * Derive a 32-byte key from a secret string using scrypt
 */
function deriveKey(secret: string): Buffer {
  // Use a fixed salt derived from the secret itself for consistency
  const salt = scryptSync(secret, 'novel-agent-keyvault-salt', KEY_LENGTH);
  return scryptSync(secret, salt, KEY_LENGTH);
}

/**
 * Encrypt a plaintext string using AES-256-GCM
 * Returns Base64(IV + AuthTag + EncryptedContent)
 */
export function encrypt(plaintext: string, secret: string): string {
  const key = deriveKey(secret);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  const result = Buffer.concat([iv, authTag, encrypted]);
  return result.toString('base64');
}

/**
 * Decrypt a Base64-encoded AES-256-GCM ciphertext
 */
export function decrypt(ciphertext: string, secret: string): string {
  const key = deriveKey(secret);
  const data = Buffer.from(ciphertext, 'base64');

  const iv = data.subarray(0, IV_LENGTH);
  const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

/**
 * Mask an API key for display purposes.
 * Returns format like "sk-...4V6J" (first 3 visible chars + ... + last 4 visible chars).
 * For keys shorter than 8 chars, returns "***...***".
 */
export function maskApiKey(apiKey: string): string {
  if (!apiKey) return '';
  if (apiKey.length <= 8) {
    return '***';
  }
  const prefix = apiKey.substring(0, 3);
  const suffix = apiKey.substring(apiKey.length - 4);
  return `${prefix}...${suffix}`;
}
