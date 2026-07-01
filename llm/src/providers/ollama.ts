import type { z } from 'zod';
import { LLMError, mapProviderError } from '../errors.js';
import type { LLMProvider } from '../index.js';

export interface OllamaConfig {
  baseUrl?: string;
  model?: string;
  timeout?: number;
}

const DEFAULT_MODEL = 'llama3.2';
const DEFAULT_TIMEOUT = 300000; // 5 minutes (matching custom provider for large documents)

/**
 * Create an Ollama LLM provider
 * Supports OLLAMA_BASE_URL, OLLAMA_MODEL, OLLAMA_TIMEOUT environment variables
 */
export function createOllamaProvider(config?: OllamaConfig): LLMProvider {
  const baseUrl = config?.baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
  const model = config?.model || process.env.OLLAMA_MODEL || DEFAULT_MODEL;
  // Support OLLAMA_TIMEOUT env var (in milliseconds)
  const envTimeout = parseInt(process.env.OLLAMA_TIMEOUT || '', 10);
  const timeout = config?.timeout || (envTimeout > 0 ? envTimeout : DEFAULT_TIMEOUT);

  let healthCache: { ok: boolean; timestamp: number } | null = null;
  const HEALTH_CACHE_TTL = 30000; // 30 seconds

  async function healthCheck(): Promise<boolean> {
    if (healthCache && Date.now() - healthCache.timestamp < HEALTH_CACHE_TTL) {
      return healthCache.ok;
    }

    let response: Response;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      try {
        response = await fetch(`${baseUrl}/api/tags`, {
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }
      healthCache = { ok: response.ok, timestamp: Date.now() };
      return response.ok;
    } catch {
      healthCache = { ok: false, timestamp: Date.now() };
      return false;
    }
  }

  return {
    name: 'ollama',

    async isConfigured(): Promise<boolean> {
      return healthCheck();
    },

    async chatExtract<T>(
      systemPrompt: string,
      userPrompt: string,
      schema: z.ZodSchema<T>
    ): Promise<T> {
      const startTime = Date.now();

      // Check if Ollama is available
      const available = await healthCheck();
      if (!available) {
        throw new LLMError(
          'Ollama is not running. Please start Ollama or use mock data.',
          'ollama',
          'NETWORK_ERROR',
          true
        );
      }

      let response: Response;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        try {
          response = await fetch(`${baseUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
              model,
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
              ],
              stream: false,
              options: {
                temperature: 0.3,
                num_predict: 1024,
              },
            }),
          });
        } finally {
          clearTimeout(timeoutId);
        }

        if (!response.ok) {
          const errorText = await response.text();
          throw new LLMError(
            `Ollama API error ${response.status}: ${errorText}`,
            'ollama',
            'UNKNOWN',
            true
          );
        }

        const data = await (response.json() as Promise<{message?: {content?: string}}>);
        const content = data.message?.content;

        if (!content) {
          throw new LLMError('Empty response from Ollama', 'ollama', 'VALIDATION_ERROR', true);
        }

        // Try to parse as JSON
        let parsed: unknown;
        try {
          parsed = JSON.parse(content);
        } catch {
          // If not JSON, wrap in object with content
          parsed = { content, raw: true };
        }

        // Validate with schema
        const result = schema.parse(parsed);

        return result;
      } catch (error) {
        if (error instanceof LLMError) {
          throw error;
        }
        throw mapProviderError(error, 'ollama');
      }
    },
  };
}
