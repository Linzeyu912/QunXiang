import type { z } from 'zod';
import { LLMError, mapProviderError, ProviderNotConfiguredError } from '../errors.js';
import type { LLMProvider } from '../index.js';
import { assertSafeOutboundUrl } from './net-guard.js';

export interface ChatExtractOptions {
  /** 调用方中止信号（如连接测试的短超时）。中止时请求立即失败并映射为超时错误。 */
  signal?: AbortSignal;
}

export interface CustomConfig {
  apiKey?: string;
  /** 多 key：同一厂家多个 key，轮询使用。优先于 apiKey。 */
  apiKeys?: string[];
  baseUrl?: string;
  model?: string;
  timeout?: number;
}

const DEFAULT_TIMEOUT = 600000; // 10 minutes for large documents

/** key 连续失败多少次后临时摘除 */
const KEY_FAIL_THRESHOLD = 3;
/** 摘除后的冷却时间（毫秒） */
const KEY_COOLDOWN_MS = 60_000;

interface KeyHealth {
  failCount: number;
  cooldownUntil: number; // 0 = 可用
}

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
/**
 * 规范化 OpenAI 兼容 API 的 base URL，兼容用户在 UI / .env 里常见的几种填法：
 *   - 完整端点（…/chat/completions）         → 原样
 *   - 带版本号的根（…/v1 或 …/v4）            → 追加 /<endpoint>
 *   - 裸域名（…/api/paas、…/com 等）          → 追加 /v1/<endpoint>（OpenAI 标准）
 * 末尾斜杠会被合并。避免用户只填根域名时拼成 /chat/completions（缺 /v1），
 * 进而打到服务商 nginx 网关层返回纯文本 404（而非 API 的 JSON 错误）。
 */
export function normalizeApiUrl(
  raw: string,
  endpoint: 'chat/completions' | 'images/generations',
): string {
  const url = raw.trim().replace(/\/+$/, '');
  if (url.endsWith(`/${endpoint}`)) return url;
  // 判断 URL 是否已经是完整端点（含非标准路径如 /v1/image/create），
  // 还是 API 版本前缀（如 /v1、/api/v3、/api/paas/v4）需要追加 endpoint。
  //
  // 规则：如果最后一段是版本号（v\d+）或整个路径只含版本前缀，则追加；
  // 否则（路径含非版本段如 image/create）视为完整端点，原样返回。
  const lastSeg = url.split('/').pop() ?? '';
  // 最后一段是版本号（v1、v3、v4 等）→ 追加 endpoint
  if (/^v\d+$/i.test(lastSeg)) return `${url}/${endpoint}`;
  // URL 已含 endpoint 关键词（chat/completions 或 images/generations 的变体）→ 原样
  if (/\/(chat|images?)\//i.test(url)) return url;
  // 路径较短（≤2 段）且不含版本号 → 追加 /v1/endpoint
  const afterHost = url.includes('://') ? url.slice(url.indexOf('://') + 3) : url;
  const pathSegs = afterHost.split('/').filter(Boolean).slice(1);
  if (pathSegs.length <= 1) return `${url}/v1/${endpoint}`;
  // 其他情况（3+ 段但最后一段非版本号）→ 视为完整端点
  return url;
}

export function createCustomProvider(config?: CustomConfig): LLMProvider {
  // 合并多 key 来源：config.apiKeys > config.apiKey > LLM_API_KEYS env > LLM_API_KEY env。
  // 同一厂家多个 key 轮询使用，把单 key 的并发额度（通常 10 路）提升到 N×10。
  function resolveKeys(): string[] {
    const collected: string[] = [];
    if (config?.apiKeys && config.apiKeys.length > 0) {
      collected.push(...config.apiKeys);
    } else if (config?.apiKey) {
      collected.push(config.apiKey);
    } else if (process.env.LLM_API_KEYS) {
      collected.push(...process.env.LLM_API_KEYS.split(',').map((s) => s.trim()).filter(Boolean));
    } else if (process.env.LLM_API_KEY) {
      collected.push(process.env.LLM_API_KEY);
    }
    // 去重（精确匹配）
    const seen = new Set<string>();
    const keys: string[] = [];
    for (const k of collected) {
      if (k && !seen.has(k)) {
        seen.add(k);
        keys.push(k);
      }
    }
    return keys;
  }

  const keys = resolveKeys();
  // 保留 apiKey 单值用于向后兼容展示（第一个 key）。
  const apiKey = keys[0] || '';

  const rawBaseUrl = config?.baseUrl || process.env.LLM_BASE_URL || 'https://api.openai.com/v1';
  const baseUrl = normalizeApiUrl(rawBaseUrl, 'chat/completions');
  const model = config?.model || process.env.LLM_MODEL || 'gpt-4o';
  // Support LLM_TIMEOUT env var (in milliseconds)
  const envTimeout = parseInt(process.env.LLM_TIMEOUT || '', 10);
  const timeout = config?.timeout || (envTimeout > 0 ? envTimeout : DEFAULT_TIMEOUT);

  // 多 key 健康状态：记录每个 key 的连续失败计数与冷却到期时间戳。
  // round-robin 游标。单 key 时退化为固定使用，无额外开销。
  const keyHealth = new Map<string, KeyHealth>();
  for (const k of keys) keyHealth.set(k, { failCount: 0, cooldownUntil: 0 });
  let keyCursor = 0;

  /** 选一个可用的 key（跳过冷却中的）。返回 null 表示全部不可用。 */
  function pickKey(): string | null {
    if (keys.length === 0) return null;
    const now = Date.now();
    // 尝试 keys.length 次（避免无限循环），找到第一个未冷却的
    for (let i = 0; i < keys.length; i++) {
      const idx = keyCursor % keys.length;
      keyCursor++;
      const k = keys[idx];
      const h = keyHealth.get(k);
      if (!h || h.cooldownUntil <= now) {
        return k;
      }
    }
    // 全部冷却中：取冷却最快到期的那个兜底（比直接报错好）
    let best: string | null = null;
    let bestUntil = Infinity;
    for (const k of keys) {
      const h = keyHealth.get(k);
      if (h && h.cooldownUntil < bestUntil) {
        bestUntil = h.cooldownUntil;
        best = k;
      }
    }
    return best;
  }

  /** 标记某 key 调用失败（仅限 429/网络类瞬态错误）。连续达阈值则摘除冷却。 */
  function markKeyFail(k: string, isTransient: boolean): void {
    const h = keyHealth.get(k);
    if (!h) return;
    if (!isTransient) return; // 永久错误（401/403）不在这里累积——直接由上层抛出
    h.failCount++;
    if (h.failCount >= KEY_FAIL_THRESHOLD) {
      h.cooldownUntil = Date.now() + KEY_COOLDOWN_MS;
      h.failCount = 0;
      console.warn(`[custom] key ${maskKey(k)} 连续失败达阈值，摘除冷却 ${KEY_COOLDOWN_MS}ms`);
    }
  }

  /** 标记某 key 调用成功，重置其失败计数。 */
  function markKeyOk(k: string): void {
    const h = keyHealth.get(k);
    if (h) {
      h.failCount = 0;
      h.cooldownUntil = 0;
    }
  }

  function maskKey(k: string): string {
    if (k.length <= 8) return '***';
    return `${k.slice(0, 3)}...${k.slice(-4)}`;
  }

  return {
    name: 'custom',

    isConfigured(): boolean {
      return keys.length > 0;
    },

    async chatExtract<T>(
      systemPrompt: string,
      userPrompt: string,
      schema: z.ZodSchema<T>,
      options?: ChatExtractOptions
    ): Promise<T> {
      if (keys.length === 0) {
        throw new ProviderNotConfiguredError('custom');
      }

      const chosenKey = pickKey();
      if (!chosenKey) {
        throw new LLMError('所有 API Key 都处于冷却中，请稍后重试或增加更多 Key。', 'custom', 'RATE_LIMIT', true);
      }

      // 出站目标防护：拦截链路本地/云元数据等只可能被 SSRF 利用的地址。
      // 本机与局域网服务是合法配置，不在拦截范围。
      try {
        assertSafeOutboundUrl(baseUrl, '模型服务接口地址被拒绝');
      } catch (err) {
        throw new LLMError(err instanceof Error ? err.message : String(err), 'custom', 'UNKNOWN', false);
      }

      const envMaxTokens = parseInt(process.env.LLM_MAX_TOKENS || '', 10);

      let response: Response;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        // 组合调用方中止信号（如连接测试的 15 秒短超时）
        const externalSignal = options?.signal;
        const onExternalAbort = () => controller.abort();
        if (externalSignal?.aborted) controller.abort();
        externalSignal?.addEventListener('abort', onExternalAbort, { once: true });
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
          // 部分兼容接口默认启用深度推理，长文本任务可能先耗尽推理额度。
          // 仅在部署方明确开启时发送关闭参数。
          if (process.env.LLM_DISABLE_THINKING === '1' || process.env.LLM_DISABLE_THINKING === 'true') {
            requestBody.thinking = { type: 'disabled' };
          }
          response = await fetch(`${baseUrl}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${chosenKey}`,
            },
            signal: controller.signal,
            body: JSON.stringify(requestBody),
          });
        } finally {
          clearTimeout(timeoutId);
          externalSignal?.removeEventListener('abort', onExternalAbort);
        }

        if (!response.ok) {
          const errorText = await response.text();
          const status = response.status;
          const snippet = errorText.slice(0, 300);
          // 429/5xx 属于瞬态错误，标记该 key 失败（多 key 下下次轮询会换 key）
          if (status === 429 || status >= 500) {
            markKeyFail(chosenKey, true);
          }
          // 按 HTTP status 映射到具体 code，让上层（测试连接、提取管线）能给出
          // 精确提示。原始 body 片段截断保留，方便用户判断是 base url / key /
          // 模型名哪一项填错（如 minimax 404 通常是 base url 拼错或模型名不存在）。
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

        // 成功：重置该 key 的失败计数与冷却
        markKeyOk(chosenKey);
        return schema.parse(parsed);
      } catch (error) {
        // AbortController 触发的超时：fetch 抛 AbortError（name==='AbortError'），
        // 单独映射为 TIMEOUT，避免被 mapProviderError 当成普通网络错误。
        if (error instanceof Error && error.name === 'AbortError') {
          markKeyFail(chosenKey, true); // 超时视为瞬态，多 key 下次换 key
          const externallyAborted = options?.signal?.aborted === true;
          throw new LLMError(
            externallyAborted
              ? '请求被调用方中止（连接测试超时或上游取消）。可能是网络不可达，或 Base URL 指向了错误的地址。'
              : `请求超时（${Math.round(timeout / 1000)}s）。可能是网络不可达，或 Base URL 指向了错误的地址。`,
            'custom', 'TIMEOUT', true,
          );
        }
        if (error instanceof LLMError) {
          throw error;
        }
        // 其它网络类错误（fetch failed / ECONNRESET 等）也标记瞬态失败
        markKeyFail(chosenKey, true);
        throw mapProviderError(error, 'custom');
      }
    },
  };
}
