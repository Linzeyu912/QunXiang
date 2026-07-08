import { z } from 'zod';
import type { LLMProvider, ProviderConfig } from './index.js';
import { createCustomProvider } from './providers/custom.js';
import { createMockProvider } from './providers/mock.js';
import { LLMError, ProviderNotConfiguredError } from './errors.js';
import { maskApiKey } from './keyVault.js';
import type { RuntimeLlmConfig } from './configStore.js';
import { saveConfigToDisk, loadConfigFromDisk, normalizeApiKeys } from './configStore.js';

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
 */
let runtimeConfig: RuntimeLlmConfig | undefined = undefined;

/**
 * 单例缓存：custom provider 持有 keyCursor/keyHealth 等闭包状态，
 * 必须 cross-call 复用同一个实例才能让多 key 轮询与健康摘除生效。
 * resolveProvider 每次都 new createCustomProvider() 会导致状态丢失
 *（游标永远从 0 开始、失败计数永远清零）——多 key 形同虚设。
 *
 * 用 Promise 缓存而非实例缓存：多 worker 并发首次调用 getDefaultProvider 时，
 * 同步赋值 in-flight Promise 可避免重复构建。
 */
let cachedCustomProviderPromise: Promise<LLMProvider> | undefined;
/** 缓存对应的配置指纹，配置变化即视为缓存失效 */
let cachedProviderKey: string | undefined;

/** 使缓存的 custom provider 失效；下次 getDefaultProvider 会用最新配置重建。 */
function invalidateProviderCache(): void {
  cachedCustomProviderPromise = undefined;
  cachedProviderKey = undefined;
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

  if (persist) {
    try {
      saveConfigToDisk(runtimeConfig);
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
export function getMaskedConfig(): { provider: string; keyHint: string; keyHints: string[]; baseUrl: string; model: string } | undefined {
  if (!runtimeConfig) return undefined;
  const keys = normalizeApiKeys(runtimeConfig);
  return {
    provider: runtimeConfig.provider,
    keyHint: keys[0] ? maskApiKey(keys[0]) : '',
    keyHints: keys.map((k) => maskApiKey(k)),
    baseUrl: runtimeConfig.baseUrl || '',
    model: runtimeConfig.model || '',
  };
}

/**
 * Load persisted config from disk on startup.
 * Called once during API server initialization.
 */
export function loadPersistedConfig(): void {
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
 * 获取（或按需创建并缓存）custom provider 单例。
 * 同一配置指纹命中缓存 → 返回同一实例，使 custom.ts 内的 keyCursor/keyHealth
 * 跨调用保留；指纹变化或缓存被 invalidateProviderCache 清空则重建。
 *
 * 用 in-flight Promise 缓存：多 worker 并发首次调用时，Promise 工厂同步赋值，
 * 后续调用 await 同一个 Promise，避免重复构建。
 */
function getOrCreateCustomProvider(
  key: string,
  factory: () => LLMProvider
): Promise<LLMProvider> {
  if (cachedProviderKey === key && cachedCustomProviderPromise) {
    return cachedCustomProviderPromise;
  }
  // 同步赋值 Promise（createCustomProvider 是同步工厂，包成 resolved Promise）
  cachedProviderKey = key;
  cachedCustomProviderPromise = Promise.resolve(factory());
  return cachedCustomProviderPromise;
}

/**
 * Internal: resolve provider from runtime config or environment variables.
 * Priority: runtimeConfig > process.env > LLM_MOCK_ENABLED > error
 */
async function resolveProvider(): Promise<LLMProvider> {
  // 1. Check runtime config first
  if (runtimeConfig) {
    switch (runtimeConfig.provider) {
      case 'custom': {
        // 多 key：用 normalizeApiKeys 合并 apiKeys/apiKey，传给 provider 轮询
        const keys = normalizeApiKeys(runtimeConfig);
        // 指纹：keys+baseUrl+model。setRuntimeConfig 已会 invalidate，这里指纹主要用于
        // 防御（如直接改了 runtimeConfig 对象的极端情况）。
        const fingerprint = JSON.stringify({ keys, baseUrl: runtimeConfig.baseUrl, model: runtimeConfig.model });
        return getOrCreateCustomProvider(fingerprint, () =>
          createCustomProvider({
            apiKeys: keys,
            baseUrl: runtimeConfig!.baseUrl,
            model: runtimeConfig!.model,
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
        return getOrCreateCustomProvider('env-custom', () => createCustomProvider());
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
 */
export async function getDefaultProvider(): Promise<LLMProvider> {
  // Runtime override takes highest priority
  if (runtimeProviderOverride === 'mock') {
    return createMockProvider();
  }
  // 'llm' or undefined — use runtime/env provider config
  return resolveProvider();
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
