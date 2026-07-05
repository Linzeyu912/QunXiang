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
  const rawBaseUrl = config?.baseUrl || process.env.LLM_BASE_URL || 'https://api.openai.com/v1';
  // 用户在 UI/env 里通常只填到 /v1（如 .env.example）。OpenAI 兼容的聊天端点
  // 是 /chat/completions，这里自动补全：已带 /chat/completions 则原样使用，
  // 否则拼上。这样无论用户填 https://api.deepseek.com/v1 还是完整路径都能工作。
  const baseUrl = rawBaseUrl.endsWith('/chat/completions')
    ? rawBaseUrl
    : `${rawBaseUrl.replace(/\/$/, '')}/chat/completions`;
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
          // 按 HTTP status 映射到具体 code，让上层（测试连接、提取管线）能给出
          // 精确提示。原始 body 片段截断保留，方便用户判断是 base url / key /
          // 模型名哪一项填错（如 minimax 404 通常是 base url 拼错或模型名不存在）。
          const status = response.status;
          const snippet = errorText.slice(0, 300);
          if (status === 401 || status === 403) {
            throw new LLMError(
              `认证失败（HTTP ${status}）。请检查 API Key 是否正确、是否与所选服务商匹配。服务端返回：${snippet}`,
              'custom', 'AUTH_ERROR', false,
            );
          }
          if (status === 404) {
            throw new LLMError(
              `接口或模型不存在（HTTP 404）。请检查 Base URL 末尾是否为 /v1（不要带 /chat/completions 以外的路径），以及模型名称是否正确。服务端返回：${snippet}`,
              'custom', 'MODEL_NOT_FOUND', false,
            );
          }
          if (status === 429) {
            throw new LLMError(
              `请求被限流（HTTP 429），稍后重试。服务端返回：${snippet}`,
              'custom', 'RATE_LIMIT', true,
            );
          }
          throw new LLMError(
            `LLM 接口返回 HTTP ${status}：${snippet}`,
            'custom', 'UNKNOWN', false,
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
        // AbortController 触发的超时：fetch 抛 AbortError（name==='AbortError'），
        // 单独映射为 TIMEOUT，避免被 mapProviderError 当成普通网络错误。
        if (error instanceof Error && error.name === 'AbortError') {
          throw new LLMError(
            `请求超时（${Math.round(timeout / 1000)}s）。可能是网络不可达，或 Base URL 指向了错误的地址。`,
            'custom', 'TIMEOUT', true,
          );
        }
        if (error instanceof LLMError) {
          throw error;
        }
        throw mapProviderError(error, 'custom');
      }
    },
  };
}
