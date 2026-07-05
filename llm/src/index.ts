import type { z } from 'zod';

/**
 * LLM Provider interface - all providers must implement this
 */
export interface LLMProvider {
  /** Provider name (e.g., 'custom' or 'mock') */
  name: string;

  /** Check if provider is configured and available */
  isConfigured(): boolean | Promise<boolean>;

  /**
   * Extract structured data using chat-based LLM call
   */
  chatExtract<T>(
    systemPrompt: string,
    userPrompt: string,
    schema: z.ZodSchema<T>
  ): Promise<T>;
}

/**
 * Provider configuration options
 */
export interface ProviderConfig {
  provider: 'openai' | 'anthropic' | 'custom';
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

/**
 * LLM-specific extraction options
 */
export interface ExtractionOptions {
  temperature?: number;
  maxTokens?: number;
  timeout?: number;
}

/**
 * Result from LLM extraction with metadata
 */
export interface ExtractionResult<T> {
  data: T;
  provider: string;
  latencyMs: number;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export { createProvider, getDefaultProvider, setRuntimeProvider, getRuntimeProviderName, setRuntimeConfig, getRuntimeConfig, getMaskedConfig, getApiKeyCount, loadPersistedConfig } from './factory.js';
export { LLMError, ProviderNotConfiguredError } from './errors.js';
export { maskApiKey } from './keyVault.js';
export { normalizeApiKeys } from './configStore.js';
export type { RuntimeLlmConfig } from './configStore.js';
