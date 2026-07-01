import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { join, resolve } from 'path';
import { randomBytes } from 'crypto';
import { encrypt, decrypt } from './keyVault.js';

/**
 * Runtime LLM configuration (stored in memory + optionally persisted to encrypted file)
 */
export interface RuntimeLlmConfig {
  provider: 'ollama' | 'custom' | 'mock';
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

/** Internal persisted format — includes encrypted apiKey */
interface PersistedConfig {
  provider: 'ollama' | 'custom' | 'mock';
  encryptedApiKey?: string; // AES-256-GCM encrypted
  baseUrl?: string;
  model?: string;
}

const CONFIG_FILENAME = '.novel-agent-config.encrypted';

/**
 * Get the project root directory for config file storage.
 * Walks up from cwd to find package.json, or falls back to cwd.
 */
function getProjectRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, 'package.json'))) {
      return dir;
    }
    const parent = resolve(dir, '..');
    if (parent === dir) break; // reached root
    dir = parent;
  }
  return process.cwd();
}

/**
 * Get the master secret for encryption.
 * Reads from KEY_VAULTS_SECRET env var.
 * If not set, auto-generates one and writes to .env file.
 */
function getMasterSecret(): string {
  const envSecret = process.env.KEY_VAULTS_SECRET;
  if (envSecret) return envSecret;

  // Auto-generate and persist
  const newSecret = randomBytes(32).toString('hex');
  const envPath = join(getProjectRoot(), 'api', '.env');

  try {
    let envContent = '';
    if (existsSync(envPath)) {
      envContent = readFileSync(envPath, 'utf8');
    }
    // Remove existing KEY_VAULTS_SECRET line if any
    const lines = envContent.split('\n').filter(
      (line: string) => !line.startsWith('KEY_VAULTS_SECRET=')
    );
    lines.push(`KEY_VAULTS_SECRET=${newSecret}`);
    const dir = join(getProjectRoot(), 'api');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(envPath, lines.join('\n'), 'utf8');
    process.env.KEY_VAULTS_SECRET = newSecret;
    return newSecret;
  } catch {
    // Fallback: use a deterministic secret for this session only
    console.warn('[configStore] Could not persist KEY_VAULTS_SECRET to .env. Encrypted config will not survive restarts.');
    const fallbackSecret = 'novel-agent-fallback-secret-do-not-use-in-production';
    process.env.KEY_VAULTS_SECRET = fallbackSecret;
    return fallbackSecret;
  }
}

/**
 * Get the config file path
 */
function getConfigPath(): string {
  return join(getProjectRoot(), CONFIG_FILENAME);
}

/**
 * Save runtime config to encrypted file
 */
export function saveConfigToDisk(config: RuntimeLlmConfig): void {
  const secret = getMasterSecret();
  const persisted: PersistedConfig = {
    provider: config.provider,
    baseUrl: config.baseUrl,
    model: config.model,
  };

  if (config.apiKey) {
    persisted.encryptedApiKey = encrypt(config.apiKey, secret);
  }

  const configPath = getConfigPath();
  const jsonStr = JSON.stringify(persisted);
  const encrypted = encrypt(jsonStr, secret);
  writeFileSync(configPath, encrypted, 'utf8');
}

/**
 * Load runtime config from encrypted file.
 * Returns null if no config file exists or decryption fails.
 */
export function loadConfigFromDisk(): RuntimeLlmConfig | null {
  const configPath = getConfigPath();
  if (!existsSync(configPath)) return null;

  try {
    const secret = getMasterSecret();
    const encrypted = readFileSync(configPath, 'utf8').trim();
    const jsonStr = decrypt(encrypted, secret);
    const persisted: PersistedConfig = JSON.parse(jsonStr);

    const result: RuntimeLlmConfig = {
      provider: persisted.provider,
      baseUrl: persisted.baseUrl,
      model: persisted.model,
    };

    if (persisted.encryptedApiKey) {
      result.apiKey = decrypt(persisted.encryptedApiKey, secret);
    }

    return result;
  } catch (error) {
    console.warn('[configStore] Failed to load encrypted config:', error instanceof Error ? error.message : String(error));
    return null;
  }
}

/**
 * Remove the encrypted config file
 */
export function clearConfigFromDisk(): boolean {
  const configPath = getConfigPath();
  try {
    if (existsSync(configPath)) {
      unlinkSync(configPath);
    }
    return true;
  } catch {
    return false;
  }
}
