import { z } from 'zod';
import type { LLMProvider, ProviderConfig, ImageProvider } from './index.js';
import { createCustomProvider } from './providers/custom.js';
import { createMockProvider } from './providers/mock.js';
import { createImageProvider } from './providers/image-custom.js';
import { LLMError, ProviderNotConfiguredError } from './errors.js';
import { maskApiKey } from './keyVault.js';
import type { RuntimeLlmConfig, RuntimeImageConfig, LlmProfile } from './configStore.js';
import {
  saveConfigToDisk,
  loadConfigFromDisk,
  loadProfilesFromDisk,
  saveProfilesToDisk,
  normalizeApiKeys,
  saveImageConfigToDisk,
  loadImageConfigFromDisk,
} from './configStore.js';

/**
 * Provider configuration schema
 */
export const llmConfigSchema = z.object({
  provider: z.enum(['openai', 'anthropic', 'custom']),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  model: z.string().optional(),
});

export type LLMConfig = z.infer<typeof llmConfigSchema>;

/**
 * Create a provider from explicit config
 */
export function createProvider(config: ProviderConfig): LLMProvider {
  switch (config.provider) {
    case 'custom':
      return createCustomProvider({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.model,
      });
    case 'openai':
      throw new LLMError(
        'OpenAI provider is not yet implemented. Use LLM_PROVIDER=custom with your own API key.',
        'openai', 'UNKNOWN', false
      );
    case 'anthropic':
      throw new LLMError(
        'Anthropic provider is not yet implemented. Use LLM_PROVIDER=custom with your own API key.',
        'anthropic', 'UNKNOWN', false
      );
  }
}

/**
 * Runtime provider override (set via API, persists in memory until restart)
 * Priority: runtimeProviderOverride > runtime API config > LLM_PROVIDER env > LLM_MOCK_ENABLED > error
 */
let runtimeProviderOverride: 'llm' | 'mock' | 'auto' | undefined = undefined;

/**
 * Runtime LLM configuration (set via UI, overrides env vars)
 * Priority: runtimeConfig > process.env
 *
 * 多档案（profiles）模式下 runtimeConfig 始终镜像「默认档案」，供旧的
 * status/getApiKeyConfig 等单一配置消费方无感兼容。
 */
let runtimeConfig: RuntimeLlmConfig | undefined = undefined;

/**
 * 服务商配置档案列表（多服务商支持）。不同厂商各一个档案；
 * 每个档案内部可放同厂多个 key 轮询。未启用档案模式时为 undefined。
 */
let runtimeProfiles: LlmProfile[] | undefined = undefined;
/** 默认档案 id（新运行/未显式指定档案时使用） */
let activeProfileId: string | undefined = undefined;

/**
 * 单例缓存：custom provider 持有 keyCursor/keyHealth 等闭包状态，
 * 必须 cross-call 复用同一个实例才能让多 key 轮询与健康摘除生效。
 * resolveProvider 每次都 new createCustomProvider() 会导致状态丢失
 *（游标永远从 0 开始、失败计数永远清零）——多 key 形同虚设。
 *
 * 按「缓存槽」分键：'active'（默认档案/env）与 'profile:<id>'（指定档案）各自持有
 * 独立的轮询游标与健康状态，多书并行时不同服务商互不干扰。
 *
 * 用 Promise 缓存而非实例缓存：多 worker 并发首次调用 getDefaultProvider 时，
 * 同步赋值 in-flight Promise 可避免重复构建。
 */
interface ProviderCacheEntry {
  /** 缓存对应的配置指纹，配置变化即视为缓存失效 */
  fingerprint: string;
  promise: Promise<LLMProvider>;
}
const providerCache = new Map<string, ProviderCacheEntry>();

/** 使全部缓存的 custom provider 失效；下次 getDefaultProvider 会用最新配置重建。 */
function invalidateProviderCache(): void {
  providerCache.clear();
}

/** 获取（或按需创建并缓存）某缓存槽的 custom provider 单例。 */
function getOrCreateCustomProvider(
  slot: string,
  fingerprint: string,
  factory: () => LLMProvider
): Promise<LLMProvider> {
  const cached = providerCache.get(slot);
  if (cached && cached.fingerprint === fingerprint) {
    return cached.promise;
  }
  // 同步赋值 Promise（createCustomProvider 是同步工厂，包成 resolved Promise）
  const entry: ProviderCacheEntry = { fingerprint, promise: Promise.resolve(factory()) };
  providerCache.set(slot, entry);
  return entry.promise;
}

/** 把档案转换成 RuntimeLlmConfig 镜像（provider 固定为 custom）。 */
function profileToRuntimeConfig(profile: LlmProfile): RuntimeLlmConfig {
  const keys = normalizeApiKeys(profile);
  return {
    provider: 'custom',
    baseUrl: profile.baseUrl,
    model: profile.model,
    thinking: profile.thinking,
    apiKeys: keys.length > 0 ? keys : undefined,
    apiKey: keys[0],
  };
}

/** 档案变化后同步 runtimeConfig 镜像与默认档案指针；档案清空时连镜像一并重置。 */
function syncActiveFromProfiles(): void {
  if (!runtimeProfiles || runtimeProfiles.length === 0) {
    // 空档案列表 = 重置状态（正常运营至少保留一个档案，仅在测试中出现）
    if (runtimeProfiles && runtimeProfiles.length === 0) runtimeConfig = undefined;
    return;
  }
  if (!activeProfileId || !runtimeProfiles.some((p) => p.id === activeProfileId)) {
    activeProfileId = runtimeProfiles[0].id;
  }
  const active = runtimeProfiles.find((p) => p.id === activeProfileId)!;
  runtimeConfig = profileToRuntimeConfig(active);
}

/**
 * 设置完整档案列表（UI 的 profiles CRUD 入口；整体替换）。
 * persist=true 时按 v2 格式加密落盘。
 */
export function setRuntimeProfiles(
  profiles: LlmProfile[],
  nextActiveProfileId: string | undefined,
  persist: boolean = true
): void {
  runtimeProfiles = profiles;
  activeProfileId = nextActiveProfileId;
  syncActiveFromProfiles();
  if (persist) {
    try {
      saveProfilesToDisk(runtimeProfiles, activeProfileId ?? null);
    } catch (err) {
      console.warn('[factory] Failed to persist profiles:', err instanceof Error ? err.message : String(err));
    }
  }
  invalidateProviderCache();
}

/** 当前档案列表（未启用档案模式时为 undefined）。 */
export function getRuntimeProfiles(): LlmProfile[] | undefined {
  return runtimeProfiles;
}

/** 默认档案 id。 */
export function getActiveProfileId(): string | undefined {
  return activeProfileId;
}

/** 按 id 取档案；不存在（含档案模式未启用）返回 undefined。 */
export function getRuntimeProfile(profileId: string): LlmProfile | undefined {
  return runtimeProfiles?.find((p) => p.id === profileId);
}

/** 全部档案的脱敏视图（安全下发前端）。 */
export function getMaskedProfiles(): Array<{
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  thinking: string;
  keyHints: string[];
  keyCount: number;
  isActive: boolean;
}> | undefined {
  if (!runtimeProfiles) return undefined;
  return runtimeProfiles.map((profile) => {
    const keys = normalizeApiKeys(profile);
    return {
      id: profile.id,
      name: profile.name,
      baseUrl: profile.baseUrl || '',
      model: profile.model || '',
      thinking: profile.thinking || '',
      keyHints: keys.map((k) => maskApiKey(k)),
      keyCount: keys.length,
      isActive: profile.id === activeProfileId,
    };
  });
}

/** 全部档案的 key 总数（worker 并发度用；档案模式未启用时退回单配置计数）。 */
export function getTotalApiKeyCount(): number {
  if (runtimeProfiles && runtimeProfiles.length > 0) {
    return runtimeProfiles.reduce((sum, profile) => sum + normalizeApiKeys(profile).length, 0);
  }
  return getApiKeyCount();
}


/**
 * Set runtime provider override.
 * - 'llm': use the LLM provider configured via environment variables
 * - 'mock': force mock mode
 * - 'auto': restore automatic detection (clear override)
 */
export function setRuntimeProvider(mode: 'llm' | 'mock' | 'auto'): void {
  if (mode === 'auto') {
    runtimeProviderOverride = undefined;
  } else {
    runtimeProviderOverride = mode;
  }
  // 切换 provider 模式（mock↔llm）后，缓存的 custom provider 不再适用，需重建
  invalidateProviderCache();
}

/**
 * Set runtime LLM configuration (from UI).
 * Uses shallow merge — only updates fields that are provided.
 * Passing apiKey as empty string '' clears the key.
 * Optionally persists to encrypted file.
 */
export function setRuntimeConfig(config: Partial<RuntimeLlmConfig>, persist: boolean = true): void {
  if (!runtimeConfig) {
    runtimeConfig = { provider: config.provider || 'custom' };
  }
  // Shallow merge
  if (config.provider !== undefined) runtimeConfig.provider = config.provider;
  if (config.apiKey !== undefined) runtimeConfig.apiKey = config.apiKey || undefined; // '' → undefined (clear)
  // 多 key：传入 apiKeys 数组时整体替换。空数组表示清空所有 key。
  if (config.apiKeys !== undefined) {
    runtimeConfig.apiKeys = config.apiKeys.filter((k) => k && k.trim()).map((k) => k.trim());
    // 同步单 key 字段，保持向后兼容（取第一个）
    runtimeConfig.apiKey = runtimeConfig.apiKeys[0];
  }
  if (config.baseUrl !== undefined) runtimeConfig.baseUrl = config.baseUrl;
  if (config.model !== undefined) runtimeConfig.model = config.model;
  // 思考模式：'' 视为清除（退回 env / 模型默认）
  if (config.thinking !== undefined) runtimeConfig.thinking = config.thinking || undefined;

  // 档案模式：把这次修改同步进默认档案，保持 runtimeConfig 镜像与档案列表一致
  if (runtimeProfiles && runtimeProfiles.length > 0 && activeProfileId) {
    const index = runtimeProfiles.findIndex((p) => p.id === activeProfileId);
    if (index >= 0) {
      const current = runtimeProfiles[index];
      runtimeProfiles[index] = {
        ...current,
        baseUrl: config.baseUrl !== undefined ? config.baseUrl : current.baseUrl,
        model: config.model !== undefined ? config.model : current.model,
        thinking: config.thinking !== undefined ? (config.thinking || undefined) : current.thinking,
        apiKeys: config.apiKeys !== undefined
          ? (config.apiKeys.filter((k) => k && k.trim()).map((k) => k.trim()))
          : config.apiKey !== undefined
            ? (config.apiKey ? [config.apiKey] : [])
            : current.apiKeys,
      };
    }
    syncActiveFromProfiles();
  }

  if (persist) {
    try {
      if (runtimeProfiles && runtimeProfiles.length > 0) {
        saveProfilesToDisk(runtimeProfiles, activeProfileId ?? null);
      } else {
        saveConfigToDisk(runtimeConfig);
      }
    } catch (err) {
      console.warn('[factory] Failed to persist config:', err instanceof Error ? err.message : String(err));
    }
  }

  // 配置已变更（key/baseUrl/model 任一改变），缓存的 provider 用的是旧配置，必须失效。
  // 这是运行期改配置的唯一入口，保证下次 getDefaultProvider 用新配置重建。
  invalidateProviderCache();
}

/**
 * Get current runtime config (for status display).
 */
export function getRuntimeConfig(): RuntimeLlmConfig | undefined {
  return runtimeConfig;
}

/**
 * 解析当前生效的 key 数量（runtimeConfig 优先，退回 env）。
 * 供调度器按 key 数自动设置 worker 并发度。
 */
export function getApiKeyCount(): number {
  if (runtimeConfig) {
    const keys = normalizeApiKeys(runtimeConfig);
    if (keys.length > 0) return keys.length;
  }
  // env 兜底
  if (process.env.LLM_API_KEYS) {
    const n = process.env.LLM_API_KEYS.split(',').map((s) => s.trim()).filter(Boolean).length;
    if (n > 0) return n;
  }
  if (process.env.LLM_API_KEY) return 1;
  return 0;
}

/**
 * Get masked runtime config (safe to send to frontend).
 * Returns undefined if no runtimeConfig is set.
 *
 * keyHint 保留（第一个 key 的 mask，向后兼容）；新增 keyHints（全部 key 的 mask 数组）。
 */
export function getMaskedConfig(): { provider: string; keyHint: string; keyHints: string[]; baseUrl: string; model: string; thinking: string } | undefined {
  if (!runtimeConfig) return undefined;
  const keys = normalizeApiKeys(runtimeConfig);
  return {
    provider: runtimeConfig.provider,
    keyHint: keys[0] ? maskApiKey(keys[0]) : '',
    keyHints: keys.map((k) => maskApiKey(k)),
    baseUrl: runtimeConfig.baseUrl || '',
    model: runtimeConfig.model || '',
    thinking: runtimeConfig.thinking || '',
  };
}

/**
 * Load persisted config from disk on startup.
 * Called once during API server initialization.
 *
 * v2 多档案文件（或 v1 单配置自动迁移）：加载档案列表并镜像默认档案；
 * v1 mock 配置：维持旧的 provider 覆盖语义。
 */
export function loadPersistedConfig(): void {
  const profileState = loadProfilesFromDisk();
  if (profileState) {
    runtimeProfiles = profileState.profiles;
    activeProfileId = profileState.activeProfileId ?? profileState.profiles[0]?.id;
    syncActiveFromProfiles();
    runtimeProviderOverride = 'llm';
    return;
  }

  const persisted = loadConfigFromDisk();
  if (persisted) {
    runtimeConfig = persisted;
    // Auto-set provider override based on persisted config
    if (persisted.provider === 'mock') {
      runtimeProviderOverride = 'mock';
    } else {
      runtimeProviderOverride = 'llm';
    }
  }
}

/**
 * Get current runtime provider name (for display purposes).
 * Returns the effective provider that getDefaultProvider() will use.
 */
export async function getRuntimeProviderName(): Promise<string> {
  if (runtimeProviderOverride === 'mock') {
    return 'mock';
  }
  // 'llm' or undefined — resolve via runtime/env provider config
  try {
    const provider = await resolveProvider();
    return provider.name;
  } catch {
    return 'none';
  }
}

/**
 * Internal: resolve provider from runtime config or environment variables.
 * Priority: 指定档案 > runtimeConfig(默认档案) > process.env > LLM_MOCK_ENABLED > error
 */
async function resolveProvider(profileId?: string): Promise<LLMProvider> {
  // 0. 指定档案（按书绑定服务商）：档案不存在时回退默认档案并告警，不中断在途运行
  if (profileId && runtimeProfiles && runtimeProfiles.length > 0) {
    const profile = runtimeProfiles.find((p) => p.id === profileId);
    if (profile && profile.id !== activeProfileId) {
      const keys = normalizeApiKeys(profile);
      const fingerprint = JSON.stringify({
        keys,
        baseUrl: profile.baseUrl,
        model: profile.model,
        thinking: profile.thinking,
      });
      return getOrCreateCustomProvider(`profile:${profile.id}`, fingerprint, () =>
        createCustomProvider({
          apiKeys: keys,
          baseUrl: profile.baseUrl,
          model: profile.model,
          thinking: profile.thinking,
        })
      );
    }
    if (!profile) {
      console.warn(`[factory] LLM 配置档案 ${profileId} 不存在（可能已被删除），回退默认档案`);
    }
    // 命中默认档案 → 走下方 active 路径（共享同一个缓存槽）
  }

  // 1. Check runtime config first
  if (runtimeConfig) {
    switch (runtimeConfig.provider) {
      case 'custom': {
        // 多 key：用 normalizeApiKeys 合并 apiKeys/apiKey，传给 provider 轮询
        const keys = normalizeApiKeys(runtimeConfig);
        // 指纹：keys+baseUrl+model+thinking。setRuntimeConfig 已会 invalidate，这里指纹主要用于
        // 防御（如直接改了 runtimeConfig 对象的极端情况）。
        const fingerprint = JSON.stringify({
          keys,
          baseUrl: runtimeConfig.baseUrl,
          model: runtimeConfig.model,
          thinking: runtimeConfig.thinking,
        });
        return getOrCreateCustomProvider('active', fingerprint, () =>
          createCustomProvider({
            apiKeys: keys,
            baseUrl: runtimeConfig!.baseUrl,
            model: runtimeConfig!.model,
            thinking: runtimeConfig!.thinking,
          })
        );
      }
      case 'mock':
        return createMockProvider();
    }
  }

  // 2. Check env vars
  const envProvider = process.env.LLM_PROVIDER as 'openai' | 'anthropic' | 'custom' | 'mock' | undefined;

  if (envProvider) {
    switch (envProvider) {
      case 'custom':
        // env 运行期不变，用固定指纹；首次构建后常驻（直到 setter 失效）
        return getOrCreateCustomProvider('env-custom', 'env-custom', () => createCustomProvider());
      case 'mock':
        return createMockProvider();
      case 'openai':
        throw new LLMError(
          'OpenAI provider is not yet implemented. Use LLM_PROVIDER=custom with your own API key.',
          'openai', 'UNKNOWN', false
        );
      case 'anthropic':
        throw new LLMError(
          'Anthropic provider is not yet implemented. Use LLM_PROVIDER=custom with your own API key.',
          'anthropic', 'UNKNOWN', false
        );
    }
  }

  // 3. Try mock if explicitly enabled
  if (process.env.LLM_MOCK_ENABLED === 'true') {
    return createMockProvider();
  }

  // No provider available - fail fast instead of silent fallback
  throw new ProviderNotConfiguredError('custom');
}

/**
 * Get default provider based on:
 * 1. Runtime override (set via API)
 * 2. LLM_PROVIDER environment variable
 * 3. Explicit LLM_MOCK_ENABLED
 * 4. Error if no API provider is configured
 *
 * @param profileId 可选：按档案取 provider（书籍运行绑定的服务商）；
 *                  缺省或档案不存在时用默认档案/env 配置。
 */
export async function getDefaultProvider(profileId?: string): Promise<LLMProvider> {
  // Runtime override takes highest priority
  if (runtimeProviderOverride === 'mock') {
    return createMockProvider();
  }
  // 'llm' or undefined — use runtime/env provider config
  return resolveProvider(profileId);
}

/**
 * Check if any LLM provider is available (for UI purposes)
 */
export async function isAnyProviderAvailable(): Promise<boolean> {
  try {
    return await createCustomProvider().isConfigured();
  } catch {
    return false;
  }
}

// 图片生成 Provider 与文本 LLM 独立配置，因为两类接口的返回结构不同。
let runtimeImageConfig: RuntimeImageConfig | undefined;

export function setRuntimeImageConfig(config: Partial<RuntimeImageConfig>): void {
  if (!runtimeImageConfig) {
    runtimeImageConfig = { provider: 'custom' };
  }
  if (config.apiKey !== undefined) runtimeImageConfig.apiKey = config.apiKey || undefined;
  if (config.baseUrl !== undefined) runtimeImageConfig.baseUrl = config.baseUrl;
  if (config.model !== undefined) runtimeImageConfig.model = config.model;
  if (config.size !== undefined) runtimeImageConfig.size = config.size || undefined;
  if (config.characterRatio !== undefined) runtimeImageConfig.characterRatio = config.characterRatio;
  if (config.itemRatio !== undefined) runtimeImageConfig.itemRatio = config.itemRatio;
  if (config.locationRatio !== undefined) runtimeImageConfig.locationRatio = config.locationRatio;

  try {
    saveImageConfigToDisk(runtimeImageConfig);
  } catch (error) {
    console.warn('[图片配置] 保存失败：', error instanceof Error ? error.message : String(error));
  }
}

export function getRuntimeImageConfig(): RuntimeImageConfig | undefined {
  return runtimeImageConfig;
}

export function getMaskedImageConfig(): {
  provider: string;
  keyHint: string;
  baseUrl: string;
  model: string;
  size: string;
  characterRatio: string;
  itemRatio: string;
  locationRatio: string;
} | undefined {
  if (!runtimeImageConfig) return undefined;
  return {
    provider: runtimeImageConfig.provider,
    keyHint: runtimeImageConfig.apiKey ? maskApiKey(runtimeImageConfig.apiKey) : '',
    baseUrl: runtimeImageConfig.baseUrl || '',
    model: runtimeImageConfig.model || '',
    size: runtimeImageConfig.size || '',
    characterRatio: runtimeImageConfig.characterRatio || '',
    itemRatio: runtimeImageConfig.itemRatio || '',
    locationRatio: runtimeImageConfig.locationRatio || '',
  };
}

export function loadPersistedImageConfig(): void {
  const persisted = loadImageConfigFromDisk();
  if (persisted) runtimeImageConfig = persisted;
}

export function createImageProviderFromConfig(config: {
  provider?: 'custom' | 'mock';
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}): ImageProvider {
  switch (config.provider) {
    case 'mock':
      throw new LLMError('暂未实现模拟图片生成服务，请使用自定义图片服务。', 'mock', 'UNKNOWN', false);
    case 'custom':
    default:
      return createImageProvider({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.model,
      });
  }
}

export function getDefaultImageProvider(): ImageProvider {
  if (runtimeImageConfig?.apiKey) {
    return createImageProvider({
      apiKey: runtimeImageConfig.apiKey,
      baseUrl: runtimeImageConfig.baseUrl,
      model: runtimeImageConfig.model,
      size: runtimeImageConfig.size,
    });
  }
  const provider = (process.env.IMAGE_PROVIDER || 'custom') as 'custom' | 'mock';
  return createImageProviderFromConfig({ provider });
}

export { createImageProvider } from './providers/image-custom.js';

export async function isImageProviderAvailable(): Promise<boolean> {
  try {
    return await getDefaultImageProvider().isConfigured();
  } catch {
    return false;
  }
}
