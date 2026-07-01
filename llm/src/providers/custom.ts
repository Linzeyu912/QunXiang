import type { z } from 'zod';
import { LLMError, mapProviderError, ProviderNotConfiguredError } from '../errors.js';
import type { LLMProvider } from '../index.js';

export interface CustomConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  timeout?: number;
}

const DEFAULT_TIMEOUT = 600000; // 10 minutes for large documents

function findFirstJsonValue(text: string): string | undefined {
  const start = text.search(/[\[{]/u);
  if (start < 0) return undefined;

  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') {
      stack.push('}');
      continue;
    }
    if (char === '[') {
      stack.push(']');
      continue;
    }
    if (char === '}' || char === ']') {
      if (stack.pop() !== char) return undefined;
      if (stack.length === 0) return text.slice(start, index + 1);
    }
  }

  return undefined;
}

function jsonContentFromResponse(content: string): string {
  const cleaned = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const jsonMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/u);
  if (jsonMatch) return jsonMatch[1].trim();
  return findFirstJsonValue(cleaned) || cleaned;
}

/**
 * Create a custom OpenAI-compatible LLM provider
 * Uses LLM_API_KEY, LLM_BASE_URL, LLM_MODEL, LLM_TIMEOUT environment variables
 */
export function createCustomProvider(config?: CustomConfig): LLMProvider {
  const apiKey = config?.apiKey || process.env.LLM_API_KEY || '';
  const baseUrl = config?.baseUrl || process.env.LLM_BASE_URL || 'https://api.openai.com/v1';
  const model = config?.model || process.env.LLM_MODEL || 'gpt-4o';
  // Support LLM_TIMEOUT env var (in milliseconds)
  const envTimeout = parseInt(process.env.LLM_TIMEOUT || '', 10);
  const timeout = config?.timeout || (envTimeout > 0 ? envTimeout : DEFAULT_TIMEOUT);

  return {
    name: 'custom',

    isConfigured(): boolean {
      return !!apiKey;
    },

    async chatExtract<T>(
      systemPrompt: string,
      userPrompt: string,
      schema: z.ZodSchema<T>
    ): Promise<T> {
      if (!apiKey) {
        throw new ProviderNotConfiguredError('custom');
      }

      const envMaxTokens = parseInt(process.env.LLM_MAX_TOKENS || '', 10);

      let response: Response;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        try {
          // max_tokens only sent when LLM_MAX_TOKENS is set — keeps default
          // behavior unchanged (avoids under/over-shooting the model's limit)
          // while giving an escape valve for large combined outputs.
          const requestBody: Record<string, unknown> = {
            model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            temperature: 0.3,
          };
          if (envMaxTokens > 0) requestBody.max_tokens = envMaxTokens;
          if (process.env.LLM_JSON_MODE === '1' || process.env.LLM_JSON_MODE === 'true') {
            requestBody.response_format = { type: 'json_object' };
          }
          response = await fetch(`${baseUrl}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`,
            },
            signal: controller.signal,
            body: JSON.stringify(requestBody),
          });
        } finally {
          clearTimeout(timeoutId);
        }

        if (!response.ok) {
          const errorText = await response.text();
          throw new LLMError(
            `Custom LLM API error ${response.status}: ${errorText}`,
            'custom',
            'UNKNOWN',
            false
          );
        }

        const data = await (response.json() as Promise<{
          choices?: Array<{ message?: { content?: string } }>;
          content?: string;
        }>);

        // OpenAI-compatible response format
        let content: string | undefined;
        if (data.choices?.[0]?.message?.content) {
          content = data.choices[0].message.content;
        }

        if (!content) {
          throw new LLMError('Empty response from custom LLM API', 'custom', 'VALIDATION_ERROR', true);
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(jsonContentFromResponse(content));
        } catch {
          throw new LLMError(`Failed to parse LLM response as JSON: ${content.substring(0, 200)}`, 'custom', 'VALIDATION_ERROR', true);
        }

        return schema.parse(parsed);
      } catch (error) {
        if (error instanceof LLMError) {
          throw error;
        }
        throw mapProviderError(error, 'custom');
      }
    },
  };
}
