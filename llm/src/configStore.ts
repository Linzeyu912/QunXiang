import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { join, resolve } from 'path';
import { randomBytes } from 'crypto';
import { encrypt, decrypt } from './keyVault.js';

/**
 * Runtime LLM configuration (stored in memory + optionally persisted to encrypted file)
 *
 * 多 key 支持：apiKeys（数组）优先于 apiKey（单值，向后兼容）。
 * 调用方读取时应统一用 normalizeApiKeys(config) 合并两者。
 */
/**
 * 思考模式：
 * - auto：不发送任何思考相关参数（跟随模型默认）
 * - off：发送 thinking.type=disabled（混合推理模型省 token；纯思考模型会被拒并自动降级）
 * - low / high / max：发送 reasoning_effort 等级（GLM-5.3 等纯思考模型的官方三档）
 */
export type ThinkingMode = 'auto' | 'off' | 'low' | 'high' | 'max';
export const THINKING_MODES: readonly ThinkingMode[] = ['auto', 'off', 'low', 'high', 'max'];

export interface RuntimeLlmConfig {
  provider: 'custom' | 'mock';
  apiKey?: string;
  /** 多 key：同一厂家的多个 API Key，轮询使用以提升并发额度。优先于 apiKey。 */
  apiKeys?: string[];
  baseUrl?: string;
  model?: string;
  /** 思考模式（UI 设置；未设置时退回 env LLM_DISABLE_THINKING） */
  thinking?: ThinkingMode;
}

/** Internal persisted format — includes encrypted apiKeys */
interface PersistedConfig {
  provider: 'custom' | 'mock';
  encryptedApiKey?: string; // AES-256-GCM encrypted（单 key，向后兼容）
  encryptedApiKeys?: string[]; // AES-256-GCM encrypted（多 key）
  baseUrl?: string;
  model?: string;
  thinking?: string;
}

/**
 * 服务商配置档案：一份完整的 LLM 接入配置（不同厂商各建一个档案，
 * 同一厂商的多个 API Key 放同一档案内轮询）。
 */
export interface LlmProfile {
  id: string;
  /** 档案显示名（如「Kimi 订阅」「DeepSeek」） */
  name: string;
  baseUrl?: string;
  model?: string;
  /** 同一服务商的多个 key，轮询使用 */
  apiKeys?: string[];
  thinking?: ThinkingMode;
}

/** v2 持久化格式：多档案列表 + 默认档案指针 */
interface PersistedProfile {
  id: string;
  name: string;
  baseUrl?: string;
  model?: string;
  thinking?: string;
  encryptedApiKeys?: string[];
}

interface PersistedConfigV2 {
  version: 2;
  activeProfileId: string | null;
  profiles: PersistedProfile[];
}

/** v1（单配置）文件迁移为档案时的默认档案 id */
export const DEFAULT_PROFILE_ID = 'default';

/**
 * 把 config 里的 apiKey / apiKeys 合并成规范化的非空 key 数组。
 * apiKeys 优先；否则退回 apiKey 单值；都没有则返回空数组。
 * 去重（按精确字符串）并过滤空串。
 */
export function normalizeApiKeys(config: Pick<RuntimeLlmConfig, 'apiKey' | 'apiKeys'> | undefined): string[] {
  if (!config) return [];
  const raw = config.apiKeys && config.apiKeys.length > 0
    ? config.apiKeys
    : config.apiKey
      ? [config.apiKey]
      : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of raw) {
    const trimmed = (k || '').trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      out.push(trimmed);
    }
  }
  return out;
}

const CONFIG_FILENAME = '.qunxiang-config.encrypted';
const IMAGE_CONFIG_FILENAME = '.qunxiang-image-config.encrypted';
// 仅用于无感读取升级前已存在的本地密钥文件；新配置一律写入群像文件名。
const LEGACY_CONFIG_FILENAME = '.novel-agent-config.encrypted';
const LEGACY_IMAGE_CONFIG_FILENAME = '.novel-agent-image-config.encrypted';

/**
 * Runtime Image configuration (stored in memory + optionally persisted to encrypted file)
 */
export interface RuntimeImageConfig {
  provider: 'custom';
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  /** 图片尺寸（Seedream/OpenAI 风格，如 "2K"/"1024x1024"），优先于 aspect_ratio */
  size?: string;
  characterRatio?: string;
  itemRatio?: string;
  locationRatio?: string;
}

/**
 * Get the project root directory for config file storage.
 * Walks up from cwd to find package.json, or falls back to cwd.
 */
function getProjectRoot(): string {
  let dir = process.cwd();
  let nearestPackageJson: string | null = null;
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) {
      return dir;
    }
    if (existsSync(join(dir, 'package.json'))) {
      nearestPackageJson ??= dir;
      try {
        const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { workspaces?: unknown };
        if (pkg.workspaces) return dir;
      } catch {
        // Keep walking; malformed package metadata should not prevent fallback.
      }
    }
    const parent = resolve(dir, '..');
    if (parent === dir) break; // reached root
    dir = parent;
  }
  return nearestPackageJson ?? process.cwd();
}

/**
 * Get the master secret for encryption.
 * Reads from KEY_VAULTS_SECRET env var.
 * If not set, auto-generates one and writes to .env file.
 *
 * 测试环境（VITEST / NODE_ENV=test）只生成进程内临时密钥，绝不写 api/.env——
 * 否则会轮换掉真实密钥，使磁盘上的加密配置（含 API key）永久无法解密
 * （2026-07-24 事故：vitest 无 dotenv 环境触发自动轮换，DeepSeek key 丢失）。
 */
function getMasterSecret(): string {
  const envSecret = process.env.KEY_VAULTS_SECRET;
  if (envSecret) return envSecret;

  const newSecret = randomBytes(32).toString('hex');
  if (process.env.VITEST || process.env.NODE_ENV === 'test') {
    process.env.KEY_VAULTS_SECRET = newSecret;
    return newSecret;
  }

  // Auto-generate and persist
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
    // 生产环境拒绝启动：用仓库内公开常量加密落盘，等于磁盘上的密钥文件公开可解
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        '[configStore] 无法将 KEY_VAULTS_SECRET 写入 api/.env，生产环境拒绝使用兜底密钥启动。' +
          '请手工在 api/.env 配置 KEY_VAULTS_SECRET（可用 openssl rand -hex 32 生成），并确认目录可写后重启。',
      );
    }
    // 开发环境保留会话内兜底（重启后加密配置失效，仅提示）
    console.warn('[configStore] Could not persist KEY_VAULTS_SECRET to .env. Encrypted config will not survive restarts.');
    const fallbackSecret = 'novel-agent-fallback-secret-do-not-use-in-production';
    process.env.KEY_VAULTS_SECRET = fallbackSecret;
    return fallbackSecret;
  }
}

/** 获取加密配置目录；生产环境可挂载独立卷保存模型配置。 */
function getConfigDirectory(): string {
  const configuredDirectory = process.env.QUNXIANG_CONFIG_DIR?.trim();
  return configuredDirectory ? resolve(configuredDirectory) : getProjectRoot();
}

/**
 * Get the config file path
 */
function getConfigPath(): string {
  return join(getConfigDirectory(), CONFIG_FILENAME);
}

function getLegacyConfigPath(): string {
  return join(getProjectRoot(), LEGACY_CONFIG_FILENAME);
}

/**
 * Save runtime config to encrypted file
 *
 * 多 key 持久化策略：
 * - 若有 apiKeys 数组（长度 > 0）：逐个加密后存入 encryptedApiKeys，不再存 encryptedApiKey。
 * - 否则退回单 key 路径（encryptedApiKey），保持与旧配置文件兼容。
 */
export function saveConfigToDisk(config: RuntimeLlmConfig): void {
  const secret = getMasterSecret();
  const persisted: PersistedConfig = {
    provider: config.provider,
    baseUrl: config.baseUrl,
    model: config.model,
    thinking: config.thinking,
  };

  const keys = normalizeApiKeys(config);
  if (keys.length > 1) {
    // 多 key：只存数组，避免与单 key 字段重复
    persisted.encryptedApiKeys = keys.map((k) => encrypt(k, secret));
  } else if (keys.length === 1) {
    // 单 key：仍写 encryptedApiKey（旧读取路径兼容），同时写数组便于升级
    persisted.encryptedApiKey = encrypt(keys[0], secret);
    persisted.encryptedApiKeys = [persisted.encryptedApiKey];
  }

  const configPath = getConfigPath();
  mkdirSync(getConfigDirectory(), { recursive: true });
  const jsonStr = JSON.stringify(persisted);
  const encrypted = encrypt(jsonStr, secret);
  writeFileSync(configPath, encrypted, 'utf8');
}

/**
 * Save multiple provider profiles to encrypted file (v2 format, same file as v1).
 *
 * v1 文件被 v2 覆盖后，旧版本程序将无法读取（version 字段缺失其 provider 校验会返回 null），
 * 属预期的一次性升级；反向不兼容期结束后可移除 v1 读取路径。
 */
export function saveProfilesToDisk(profiles: LlmProfile[], activeProfileId: string | null): void {
  const secret = getMasterSecret();
  const persisted: PersistedConfigV2 = {
    version: 2,
    activeProfileId,
    profiles: profiles.map((profile) => {
      const keys = normalizeApiKeys(profile);
      const entry: PersistedProfile = {
        id: profile.id,
        name: profile.name,
        baseUrl: profile.baseUrl,
        model: profile.model,
        thinking: profile.thinking,
      };
      if (keys.length > 0) entry.encryptedApiKeys = keys.map((k) => encrypt(k, secret));
      return entry;
    }),
  };
  const configPath = getConfigPath();
  mkdirSync(getConfigDirectory(), { recursive: true });
  const encrypted = encrypt(JSON.stringify(persisted), secret);
  writeFileSync(configPath, encrypted, 'utf8');
}

/** 读取并解密配置文件原始 JSON；文件不存在或解密失败返回 null。 */
function readPersistedConfigJson(): Record<string, unknown> | null {
  const preferredPath = getConfigPath();
  const configPath = existsSync(preferredPath) ? preferredPath : getLegacyConfigPath();
  if (!existsSync(configPath)) return null;
  try {
    const secret = getMasterSecret();
    const encrypted = readFileSync(configPath, 'utf8').trim();
    const jsonStr = decrypt(encrypted, secret);
    return JSON.parse(jsonStr) as Record<string, unknown>;
  } catch (error) {
    console.warn('[configStore] Failed to load encrypted config:', error instanceof Error ? error.message : String(error));
    return null;
  }
}

/**
 * Load provider profiles from encrypted file.
 * - v2 文件：直接读取档案列表；
 * - v1 单配置文件：无感迁移为单个档案（id=default，名称「默认配置」），下次保存时落盘为 v2；
 * - 无文件/解密失败：返回 null（走 env 兜底）。
 */
export function loadProfilesFromDisk(): { profiles: LlmProfile[]; activeProfileId: string | null } | null {
  const persisted = readPersistedConfigJson();
  if (!persisted) return null;

  if (persisted.version === 2 && Array.isArray(persisted.profiles)) {
    const secret = getMasterSecret();
    const profiles: LlmProfile[] = [];
    for (const raw of persisted.profiles as Array<Record<string, unknown>>) {
      if (typeof raw.id !== 'string' || !raw.id) continue;
      const apiKeys = Array.isArray(raw.encryptedApiKeys)
        ? (raw.encryptedApiKeys as string[])
            .map((c) => {
              try { return decrypt(c, secret); } catch { return ''; }
            })
            .filter((k): k is string => Boolean(k))
        : undefined;
      profiles.push({
        id: raw.id,
        name: typeof raw.name === 'string' && raw.name ? raw.name : raw.id,
        baseUrl: typeof raw.baseUrl === 'string' ? raw.baseUrl : undefined,
        model: typeof raw.model === 'string' ? raw.model : undefined,
        apiKeys: apiKeys && apiKeys.length > 0 ? apiKeys : undefined,
        thinking: THINKING_MODES.includes(raw.thinking as ThinkingMode)
          ? raw.thinking as ThinkingMode
          : undefined,
      });
    }
    if (profiles.length === 0) return null;
    const activeId = typeof persisted.activeProfileId === 'string' ? persisted.activeProfileId : null;
    return {
      profiles,
      activeProfileId: activeId && profiles.some((p) => p.id === activeId) ? activeId : profiles[0].id,
    };
  }

  // v1 单配置 → 包装为单个档案
  if (persisted.provider !== 'custom' && persisted.provider !== 'mock') return null;
  const profile = configFromPersistedV1(persisted);
  if (!profile) return null;
  return { profiles: [profile], activeProfileId: profile.id };
}

/** v1 持久化结构 → 迁移档案（与 loadConfigFromDisk 的解析规则一致）。 */
function configFromPersistedV1(persisted: Record<string, unknown>): LlmProfile | null {
  const secret = getMasterSecret();
  const apiKeys: string[] = [];
  if (Array.isArray(persisted.encryptedApiKeys)) {
    for (const c of persisted.encryptedApiKeys as string[]) {
      try {
        const key = decrypt(c, secret);
        if (key) apiKeys.push(key);
      } catch {
        // 单个 key 解密失败跳过
      }
    }
  } else if (typeof persisted.encryptedApiKey === 'string') {
    try {
      const key = decrypt(persisted.encryptedApiKey, secret);
      if (key) apiKeys.push(key);
    } catch {
      // 旧单 key 解密失败视为无 key
    }
  }
  return {
    id: DEFAULT_PROFILE_ID,
    name: '默认配置',
    baseUrl: typeof persisted.baseUrl === 'string' ? persisted.baseUrl : undefined,
    model: typeof persisted.model === 'string' ? persisted.model : undefined,
    apiKeys: apiKeys.length > 0 ? apiKeys : undefined,
    thinking: THINKING_MODES.includes(persisted.thinking as ThinkingMode)
      ? persisted.thinking as ThinkingMode
      : undefined,
  };
}

/**
 * Load runtime config from encrypted file.
 * Returns null if no config file exists or decryption fails.
 *
 * v2 多档案文件：返回「默认档案」对应的单份配置（向后兼容旧调用方，
 * 完整档案列表请用 loadProfilesFromDisk）。
 * 读取时同时兼容旧的单 key 文件（encryptedApiKey）和新的多 key 文件（encryptedApiKeys）。
 */
export function loadConfigFromDisk(): RuntimeLlmConfig | null {
  const persisted = readPersistedConfigJson();
  if (!persisted) return null;

  if (persisted.version === 2) {
    const profileState = loadProfilesFromDisk();
    if (!profileState) return null;
    const active = profileState.profiles.find((p) => p.id === profileState.activeProfileId)
      ?? profileState.profiles[0];
    const keys = normalizeApiKeys(active);
    return {
      provider: 'custom',
      baseUrl: active.baseUrl,
      model: active.model,
      thinking: active.thinking,
      apiKeys: keys.length > 0 ? keys : undefined,
      apiKey: keys[0],
    };
  }

  if (persisted.provider !== 'custom' && persisted.provider !== 'mock') {
    return null;
  }

  const secret = getMasterSecret();
  const result: RuntimeLlmConfig = {
    provider: persisted.provider,
    baseUrl: typeof persisted.baseUrl === 'string' ? persisted.baseUrl : undefined,
    model: typeof persisted.model === 'string' ? persisted.model : undefined,
    // 兼容历史文件：只在合法枚举内恢复，否则丢弃（等价于未设置）
    thinking: THINKING_MODES.includes(persisted.thinking as ThinkingMode)
      ? persisted.thinking as ThinkingMode
      : undefined,
  };

  if (Array.isArray(persisted.encryptedApiKeys) && (persisted.encryptedApiKeys as string[]).length > 0) {
    // 多 key 文件：解密数组，过滤解密失败/空值
    result.apiKeys = (persisted.encryptedApiKeys as string[])
      .map((c) => {
        try { return decrypt(c, secret); } catch { return ''; }
      })
      .filter((k): k is string => Boolean(k));
    // 兼容：单 key 时同步写回 apiKey 字段
    if (result.apiKeys.length === 1) result.apiKey = result.apiKeys[0];
  } else if (typeof persisted.encryptedApiKey === 'string') {
    // 旧的单 key 文件
    result.apiKey = decrypt(persisted.encryptedApiKey, secret);
  }

  return result;
}

/**
 * Remove the encrypted config file
 */
export function clearConfigFromDisk(): boolean {
  try {
    for (const configPath of [getConfigPath(), getLegacyConfigPath()]) {
      if (existsSync(configPath)) unlinkSync(configPath);
    }
    return true;
  } catch {
    return false;
  }
}

// ── Image config persistence (separate file, same encryption) ──

function getImageConfigPath(): string {
  return join(getConfigDirectory(), IMAGE_CONFIG_FILENAME);
}

function getLegacyImageConfigPath(): string {
  return join(getProjectRoot(), LEGACY_IMAGE_CONFIG_FILENAME);
}

export function saveImageConfigToDisk(config: RuntimeImageConfig): void {
  const secret = getMasterSecret();
  const persisted: Record<string, string | undefined> = {
    provider: config.provider,
    baseUrl: config.baseUrl,
    model: config.model,
    characterRatio: config.characterRatio,
    itemRatio: config.itemRatio,
    locationRatio: config.locationRatio,
  };
  if (config.apiKey) {
    persisted.encryptedApiKey = encrypt(config.apiKey, secret);
  }
  const jsonStr = JSON.stringify(persisted);
  mkdirSync(getConfigDirectory(), { recursive: true });
  const encrypted = encrypt(jsonStr, secret);
  writeFileSync(getImageConfigPath(), encrypted, 'utf8');
}

export function loadImageConfigFromDisk(): RuntimeImageConfig | null {
  const preferredPath = getImageConfigPath();
  const configPath = existsSync(preferredPath) ? preferredPath : getLegacyImageConfigPath();
  if (!existsSync(configPath)) return null;
  try {
    const secret = getMasterSecret();
    const encrypted = readFileSync(configPath, 'utf8').trim();
    const jsonStr = decrypt(encrypted, secret);
    const persisted = JSON.parse(jsonStr) as Record<string, string | undefined>;
    if (persisted.provider !== 'custom') return null;
    const result: RuntimeImageConfig = {
      provider: 'custom',
      baseUrl: persisted.baseUrl,
      model: persisted.model,
      characterRatio: persisted.characterRatio,
      itemRatio: persisted.itemRatio,
      locationRatio: persisted.locationRatio,
    };
    if (persisted.encryptedApiKey) {
      result.apiKey = decrypt(persisted.encryptedApiKey, secret);
    }
    return result;
  } catch (error) {
    console.warn('[configStore] Failed to load encrypted image config:', error instanceof Error ? error.message : String(error));
    return null;
  }
}
