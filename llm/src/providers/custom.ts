import type { z } from 'zod';
import { LLMError, mapProviderError, ProviderNotConfiguredError } from '../errors.js';
import type { LLMProvider } from '../index.js';
import { assertSafeOutboundUrl } from './net-guard.js';
import type { ThinkingMode } from '../configStore.js';

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
  /** 思考模式（UI 设置）。未设置时退回 env：LLM_DISABLE_THINKING=1 → off，否则 auto。 */
  thinking?: ThinkingMode;
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

/**
 * 参数容错：不同服务商对可选参数的支持差异很大（如 Kimi K3 / GLM-5.3 这类
 * 「始终思考」模型拒绝 thinking.type=disabled；部分新模型只认 max_completion_tokens、
 * 固定 temperature=1.0 等）。策略：请求被 400 拒绝且报文点名了某个可选参数时，
 * 剔除该参数立即重试（最多剥 3 层），并按模型记住——后续调用直接不发，
 * 避免每个请求都白挨一次 400。
 */
type TunableParam = 'thinking' | 'reasoning_effort' | 'temperature' | 'max_tokens' | 'response_format';

const droppedParamsByModel = new Map<string, Set<TunableParam>>();

/** 剔除记忆按「端点+模型」隔离：不同服务商可能暴露同名模型（如都有 kimi-k3），
 *  一家拒绝过的参数不该影响另一家 */
function droppedParamsKey(baseUrl: string, model: string): string {
  return `${baseUrl}|${model}`;
}

/** 智谱「始终思考」拒绝（code 1210）：报文不点名参数名，语义上对应 thinking */
function isAlwaysThinkingRejection(errorText: string): boolean {
  return /"code"\s*:\s*1210|始终思考|不支持关闭思考/u.test(errorText);
}

/** 从 400 报文中识别被拒绝的参数；识别不出返回 undefined（不做剔除重试） */
function detectRejectedParam(errorText: string): TunableParam | undefined {
  if (isAlwaysThinkingRejection(errorText)) return 'thinking';
  // reasoning_effort 先判：部分服务商称其为 thinking_level，避免被 thinking 规则抢先命中
  if (/reasoning_effort|thinking_level|思考等级/i.test(errorText)) return 'reasoning_effort';
  if (/thinking/i.test(errorText)) return 'thinking';
  if (/temperature/i.test(errorText)) return 'temperature';
  if (/max_tokens/i.test(errorText)) return 'max_tokens';
  if (/response_format/i.test(errorText)) return 'response_format';
  return undefined;
}

/** 按「端点+模型」记忆剔除某个参数 */
function rememberDroppedParam(key: string, param: TunableParam): void {
  let dropped = droppedParamsByModel.get(key);
  if (!dropped) {
    dropped = new Set();
    droppedParamsByModel.set(key, dropped);
  }
  dropped.add(param);
}

/** 解析生效的思考模式：显式配置优先，env LLM_DISABLE_THINKING 兜底，默认 auto */
function resolveThinkingMode(config?: CustomConfig): ThinkingMode {
  if (config?.thinking) return config.thinking;
  if (process.env.LLM_DISABLE_THINKING === '1' || process.env.LLM_DISABLE_THINKING === 'true') {
    return 'off';
  }
  return 'auto';
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
 * 截断 JSON 自愈：输出被 max_tokens 截断时（finish_reason=length），
 * 从尾部向前找最后一个完整的值边界，补齐未闭合的容器后重试解析。
 * 救回已完成的部分（如 {"characters":[完整1,完整2,截断3 → [完整1,完整2]），
 * 丢掉的只是最后半个实体——由调用方的拆章降级再兜底。
 * 无法救回（无完整边界/补全后仍非法）返回 undefined。
 */
export function salvageTruncatedJson(text: string): unknown | undefined {
  for (let end = text.length - 1; end >= 0; end -= 1) {
    const ch = text[end];
    if (ch !== '}' && ch !== ']') continue;
    const candidate = text.slice(0, end + 1);
    // 原样可解析（截断恰好落在完整值之后，如尾随逗号被截掉）
    try {
      return JSON.parse(candidate);
    } catch {
      // 继续尝试补全
    }
    // 计算未闭合的容器并补齐
    const stack: string[] = [];
    let inString = false;
    let escaped = false;
    let salvageable = true;
    for (let i = 0; i < candidate.length; i += 1) {
      const c = candidate[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === '"') inString = false;
        continue;
      }
      if (c === '"') { inString = true; continue; }
      if (c === '{') stack.push('}');
      else if (c === '[') stack.push(']');
      else if (c === '}' || c === ']') {
        if (stack.pop() !== c) { salvageable = false; break; }
      }
    }
    if (!salvageable || inString || stack.length === 0) continue;
    // 去掉尾部悬挂逗号后补闭合符：栈是外→内入栈，闭合需内→外（逆序）
    const trimmed = candidate.replace(/[\s,]+$/u, '');
    const completed = trimmed + [...stack].reverse().join('');
    try {
      return JSON.parse(completed);
    } catch {
      continue;
    }
  }
  return undefined;
}

/**
 * Create a custom OpenAI-compatible LLM provider
 * Uses LLM_API_KEY, LLM_BASE_URL, LLM_MODEL, LLM_TIMEOUT environment variables
 */
/**
 * 规范化 OpenAI 兼容 API 的 base URL，兼容用户在 UI / .env 里常见的几种填法：
 *   - 完整端点（…/chat/completions）         → 原样
 *   - 带版本号的根（…/v1、…/v4、…/v1beta）    → 追加 /<endpoint>
 *   - 裸域名（…/api/paas、…/com 等）          → 追加 /v1/<endpoint>（OpenAI 标准）
 *   - 网关前缀（…/v1beta/openai、…/api/llm）  → 追加 /<endpoint>
 * 末尾斜杠会被合并。避免用户只填根域名时拼成 /chat/completions（缺 /v1），
 * 进而打到服务商 nginx 网关层返回纯文本 404（而非 API 的 JSON 错误）。
 * 用户若真填了不含 chat 关键词的非标准完整端点，chatExtract 的 404 兜底会用
 * 原样地址再试一次，两种形态总有一种能通。
 */
export function normalizeApiUrl(
  raw: string,
  endpoint: 'chat/completions' | 'images/generations',
): string {
  const url = raw.trim().replace(/\/+$/, '');
  if (url.endsWith(`/${endpoint}`)) return url;
  // URL 已含 endpoint 关键词（chat/completions 或 images/generations 的变体）→ 原样
  if (/\/(chat|images?)\//i.test(url)) return url;
  const lastSeg = url.split('/').pop() ?? '';
  // 最后一段是版本号（v1、v3、v4、v1beta 等字母后缀变体）→ 追加 endpoint
  if (/^v\d+[a-z]*$/i.test(lastSeg)) return `${url}/${endpoint}`;
  // 路径较短（≤1 段）且不含版本号 → 追加 /v1/endpoint
  const afterHost = url.includes('://') ? url.slice(url.indexOf('://') + 3) : url;
  const pathSegs = afterHost.split('/').filter(Boolean).slice(1);
  if (pathSegs.length <= 1) return `${url}/v1/${endpoint}`;
  // 其余（≥2 段且末段非版本号，如 /v1beta/openai、/api/llm）→ 追加 endpoint。
  // 旧逻辑在此原样发送，等于把网关前缀当完整端点打出去，必然 404。
  return `${url}/${endpoint}`;
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
  // 实际请求地址：规范化结果命中 404 时会回退用户原样地址一次（见 chatExtract），
  // 成功后记住该形态，本 provider 实例后续调用直接使用。
  let requestBaseUrl = baseUrl;
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
      // 若失败响应的 body 已在「始终思考」探测中读过，暂存于此避免二次消费
      let prefetchedErrorText: string | null = null;
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
          // 思考模式：off → 混合推理模型发送关闭参数；low/high/max → reasoning_effort
          // 等级（GLM-5.3 / Kimi K3 等纯思考模型的官方三档）；auto → 不发任何思考参数。
          // 参数被服务商拒绝的情况由下方的「点名剔除重试」兜底，构建时不再特判。
          const thinkingMode = resolveThinkingMode(config);
          if (thinkingMode === 'off') {
            requestBody.thinking = { type: 'disabled' };
          } else if (thinkingMode === 'low' || thinkingMode === 'high' || thinkingMode === 'max') {
            requestBody.reasoning_effort = thinkingMode;
          }

          // 该「端点+模型」历史上被拒过的参数直接不发
          const dropped = droppedParamsByModel.get(droppedParamsKey(baseUrl, model));
          if (dropped) {
            for (const param of dropped) delete requestBody[param];
          }
          // 若首个响应被读取用于探测，其文本暂存于此，避免重复消费 response body
          const sendChatRequest = () => fetch(`${requestBaseUrl}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${chosenKey}`,
            },
            signal: controller.signal,
            body: JSON.stringify(requestBody),
          });
          response = await sendChatRequest();
          // 参数容错：400 报文点名可选参数（thinking / reasoning_effort / temperature /
          // max_tokens / response_format）时逐个剔除重试（最多 3 层），并按端点+模型记住。
          // 探测读过的 body 暂存给错误处理复用，避免二次消费。
          const droppedKey = droppedParamsKey(baseUrl, model);
          let probeRounds = 0;
          while (!response.ok && response.status === 400 && probeRounds < 3) {
            const probeText = await response.text();
            const paramToDrop = detectRejectedParam(probeText);
            if (!paramToDrop || requestBody[paramToDrop] === undefined) {
              prefetchedErrorText = probeText;
              break;
            }
            rememberDroppedParam(droppedKey, paramToDrop);
            delete requestBody[paramToDrop];
            probeRounds++;
            response = await sendChatRequest();
          }
          // 404 兜底：规范化追加的路径形态不被该网关接受时（少数中转只认原始路径），
          // 用用户原样地址再试一次；成功则本实例后续调用都沿用原样地址。
          if (!response.ok && response.status === 404 && requestBaseUrl !== rawBaseUrl) {
            requestBaseUrl = rawBaseUrl;
            response = await sendChatRequest();
          }
        } finally {
          clearTimeout(timeoutId);
          externalSignal?.removeEventListener('abort', onExternalAbort);
        }

        if (!response.ok) {
          const status = response.status;
          const snippet = (prefetchedErrorText ?? await response.text()).slice(0, 300);
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
              `接口或模型不存在（HTTP 404）。已自动尝试两种地址形态仍失败，请核对 Base URL 与模型名是否属于同一服务商（已尝试：${baseUrl} 与 ${rawBaseUrl}）。服务端返回：${snippet}`,
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
        const jsonText = jsonContentFromResponse(content);
        try {
          parsed = JSON.parse(jsonText);
        } catch {
          // 输出被截断时的自愈：救回完整前缀，只丢最后半个实体（拆章降级兜底）
          const salvaged = salvageTruncatedJson(jsonText);
          if (salvaged === undefined) {
            throw new LLMError(`Failed to parse LLM response as JSON: ${content.substring(0, 200)}`, 'custom', 'VALIDATION_ERROR', true);
          }
          console.warn('[custom] LLM 输出 JSON 疑似截断，已救回完整前缀');
          parsed = salvaged;
        }

        // 成功：重置该 key 的失败计数与冷却
        markKeyOk(chosenKey);
        try {
          return schema.parse(parsed);
        } catch (schemaError) {
          // zod 校验失败的原始 message 是 issues 的 JSON 数组，日志里不可读；
          // 提炼成"哪个字段不符合预期"，否则像服饰补写这类 schema 与指令
          // 不一致的问题（key 必填 name）极难定位。
          const issues =
            typeof schemaError === 'object' && schemaError !== null && 'issues' in schemaError
              ? (schemaError as { issues: Array<{ path: (string | number)[]; message: string }> }).issues
              : [];
          const summary = issues
            .slice(0, 5)
            .map((issue) => `${issue.path.join('.') || '(根)'}: ${issue.message}`)
            .join('; ');
          throw new LLMError(
            `LLM 返回结构不符合预期${summary ? `（${summary}）` : ''}`,
            'custom', 'VALIDATION_ERROR', true,
          );
        }
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
