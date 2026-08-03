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

/**
 * Image Provider interface - text-to-image generation.
 * Separate from LLMProvider because the API shape differs (binary/url vs JSON).
 * Pluggable so models can be swapped (reve → DALL-E → SD ...) via env config.
 */
export interface ImageProvider {
  /** Provider name (e.g., 'custom' or 'mock') */
  name: string;

  /** Check if provider is configured and available */
  isConfigured(): boolean | Promise<boolean>;

  /**
   * Generate an image from a text prompt.
   * @returns the image buffer + mime type
   */
  generateImage(prompt: string, opts?: {
    aspectRatio?: string;   // "16:9" | "3:4" | "1:1" ... (provider-dependent)
    seed?: number;
  }): Promise<{ buffer: Buffer; mime: string }>;
}

export { createProvider, getDefaultProvider, setRuntimeProvider, getRuntimeProviderName, setRuntimeConfig, getRuntimeConfig, getMaskedConfig, getApiKeyCount, loadPersistedConfig, getDefaultImageProvider, createImageProvider, isImageProviderAvailable, setRuntimeImageConfig, getRuntimeImageConfig, getMaskedImageConfig, loadPersistedImageConfig } from './factory.js';
export type { RuntimeImageConfig } from './configStore.js';
export { LLMError, ProviderNotConfiguredError } from './errors.js';
export { maskApiKey } from './keyVault.js';
export { normalizeApiKeys } from './configStore.js';
export type { RuntimeLlmConfig } from './configStore.js';
export { PROVIDER_PRESETS, IMAGE_PROVIDER_PRESETS } from './providers/presets.js';
export type { ProviderPreset, ProviderModel } from './providers/presets.js';
