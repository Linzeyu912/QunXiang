import { z } from 'zod';
import type { LLMProvider, ProviderConfig } from './index.js';
import { createCustomProvider } from './providers/custom.js';
import { createMockProvider } from './providers/mock.js';
import { LLMError, ProviderNotConfiguredError } from './errors.js';
import { maskApiKey } from './keyVault.js';
import type { RuntimeLlmConfig } from './configStore.js';
import { saveConfigToDisk, loadConfigFromDisk } from './configStore.js';

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
  if (config.baseUrl !== undefined) runtimeConfig.baseUrl = config.baseUrl;
  if (config.model !== undefined) runtimeConfig.model = config.model;

  if (persist) {
    try {
      saveConfigToDisk(runtimeConfig);
    } catch (err) {
      console.warn('[factory] Failed to persist config:', err instanceof Error ? err.message : String(err));
    }
  }
}

/**
 * Get current runtime config (for status display).
 */
export function getRuntimeConfig(): RuntimeLlmConfig | undefined {
  return runtimeConfig;
}

/**
 * Get masked runtime config (safe to send to frontend).
 * Returns undefined if no runtimeConfig is set.
 */
export function getMaskedConfig(): { provider: string; keyHint: string; baseUrl: string; model: string } | undefined {
  if (!runtimeConfig) return undefined;
  return {
    provider: runtimeConfig.provider,
    keyHint: runtimeConfig.apiKey ? maskApiKey(runtimeConfig.apiKey) : '',
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
 * Internal: resolve provider from runtime config or environment variables.
 * Priority: runtimeConfig > process.env > LLM_MOCK_ENABLED > error
 */
async function resolveProvider(): Promise<LLMProvider> {
  // 1. Check runtime config first
  if (runtimeConfig) {
    switch (runtimeConfig.provider) {
      case 'custom':
        return createCustomProvider({
          apiKey: runtimeConfig.apiKey,
          baseUrl: runtimeConfig.baseUrl,
          model: runtimeConfig.model,
        });
      case 'mock':
        return createMockProvider();
    }
  }

  // 2. Check env vars
  const envProvider = process.env.LLM_PROVIDER as 'openai' | 'anthropic' | 'custom' | 'mock' | undefined;

  if (envProvider) {
    switch (envProvider) {
      case 'custom':
        return createCustomProvider();
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
