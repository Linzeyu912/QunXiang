import type { FastifyInstance } from 'fastify';
import { getDefaultProvider, setRuntimeProvider, getRuntimeProviderName, setRuntimeConfig, getMaskedConfig, getApiKeyCount, loadPersistedConfig } from '@novel-agent/llm';
import type { RuntimeLlmConfig } from '@novel-agent/llm';
import { reconfigureWorkers, getConcurrencyStatus, type ConcurrencyMode } from '../services/extraction.service.js';

/**
 * Health check endpoints for the API
 */
export async function healthRoutes(fastify: FastifyInstance) {
  // Load persisted config on startup
  try {
    loadPersistedConfig();
  } catch (err) {
    console.warn('[health] Failed to load persisted config:', err instanceof Error ? err.message : String(err));
  }

  // Basic health check
  fastify.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // LLM provider health check
  fastify.get('/llm', async (request, reply) => {
    try {
      const providerName = await getRuntimeProviderName();
      const provider = await getDefaultProvider();
      const isConfigured = await provider.isConfigured();
      const maskedConfig = getMaskedConfig();
      const concurrency = getConcurrencyStatus();

      return {
        provider: providerName,
        configured: isConfigured,
        canExtract: isConfigured,
        keyHint: maskedConfig?.keyHint || '',
        keyHints: maskedConfig?.keyHints || [],
        keyCount: getApiKeyCount(),
        baseUrl: maskedConfig?.baseUrl || '',
        model: maskedConfig?.model || '',
        concurrency,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return reply.status(503).send({
        provider: 'none',
        configured: false,
        canExtract: false,
        keyHint: '',
        keyHints: [],
        keyCount: 0,
        baseUrl: '',
        model: '',
        concurrency: { mode: 'parallel-books', keyCount: 0, workers: 0, recommended: 1 },
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      });
    }
  });

  // Set runtime LLM provider mode
  fastify.patch('/llm', async (request, reply) => {
    const body = request.body as { provider?: string } | undefined;
    const mode = body?.provider;

    if (!mode || !['llm', 'mock', 'auto'].includes(mode)) {
      return reply.status(400).send({
        error: 'Invalid provider value. Must be "llm", "mock", or "auto".',
      });
    }

    try {
      setRuntimeProvider(mode as 'llm' | 'mock' | 'auto');
      const providerName = await getRuntimeProviderName();
      const provider = await getDefaultProvider();
      const isConfigured = await provider.isConfigured();
      const maskedConfig = getMaskedConfig();

      return {
        provider: providerName,
        configured: isConfigured,
        canExtract: isConfigured,
        keyHint: maskedConfig?.keyHint || '',
        baseUrl: maskedConfig?.baseUrl || '',
        model: maskedConfig?.model || '',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return reply.status(503).send({
        provider: 'none',
        configured: false,
        canExtract: false,
        keyHint: '',
        baseUrl: '',
        model: '',
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      });
    }
  });

  // Configure LLM provider (API Key, Base URL, Model) — 支持多 key
  fastify.patch('/llm/config', async (request, reply) => {
    const body = request.body as {
      provider?: 'custom';
      apiKey?: string;
      apiKeys?: string[];
      baseUrl?: string;
      model?: string;
    } | undefined;

    if (!body || !body.provider) {
      return reply.status(400).send({
        error: 'Missing required field: provider (custom)',
      });
    }

    if (body.provider !== 'custom') {
      return reply.status(400).send({
        error: 'Invalid provider. Must be "custom".',
      });
    }

    // 合并校验目标：若有 apiKeys 数组则校验每个；否则退回 apiKey 单值校验。
    const keysToCheck = Array.isArray(body.apiKeys)
      ? body.apiKeys
      : body.apiKey !== undefined
        ? [body.apiKey]
        : [];

    // 基本合理性校验：拦截浏览器自动填充串进来的注册账号/密码。
    const emailLike = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    for (const raw of keysToCheck) {
      const k = (raw || '').trim();
      if (!k) continue; // 空串=清除该项，允许
      if (emailLike.test(k)) {
        return reply.status(400).send({
          error: 'API Key 看起来像邮箱地址，请检查是否被浏览器自动填充了注册账号。',
        });
      }
      if (/\s/.test(k)) {
        return reply.status(400).send({ error: 'API Key 不应包含空白字符。' });
      }
    }

    if (body.model !== undefined && body.model.trim() !== '') {
      const emailLike = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (emailLike.test(body.model.trim())) {
        return reply.status(400).send({
          error: '模型名称看起来像邮箱地址，请检查是否被浏览器自动填充了注册账号。',
        });
      }
      if (body.model.length > 128) {
        return reply.status(400).send({ error: '模型名称过长（上限 128 字符）。' });
      }
    }

    if (body.baseUrl !== undefined && body.baseUrl.trim() !== '') {
      const url = body.baseUrl.trim();
      if (!/^https?:\/\//i.test(url)) {
        return reply.status(400).send({ error: 'Base URL 必须以 http:// 或 https:// 开头。' });
      }
    }

    try {
      const config: Partial<RuntimeLlmConfig> = {
        provider: body.provider,
      };
      // 多 key：传 apiKeys 数组（factory 内会整体替换）；未传则不动现有 key。
      if (body.apiKeys !== undefined) config.apiKeys = body.apiKeys;
      else if (body.apiKey !== undefined) config.apiKey = body.apiKey;
      if (body.baseUrl !== undefined) config.baseUrl = body.baseUrl;
      if (body.model !== undefined) config.model = body.model;

      setRuntimeConfig(config, true);

      setRuntimeProvider('llm');

      // key 数变化后，按当前并发模式重新应用 worker 数（热重载，无需重启）
      const concurrency = reconfigureWorkers(getConcurrencyStatus().mode);

      const providerName = await getRuntimeProviderName();
      const provider = await getDefaultProvider();
      const isConfigured = await provider.isConfigured();
      const maskedConfig = getMaskedConfig();

      return {
        provider: providerName,
        configured: isConfigured,
        canExtract: isConfigured,
        keyHint: maskedConfig?.keyHint || '',
        keyHints: maskedConfig?.keyHints || [],
        keyCount: getApiKeyCount(),
        baseUrl: maskedConfig?.baseUrl || '',
        model: maskedConfig?.model || '',
        concurrency,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({
        error: '内部错误，请查看服务端日志',
        timestamp: new Date().toISOString(),
      });
    }
  });

  // 切换并发模式（优先并行本数 / 优先单本速度），热重载 worker 数，无需重启 API
  fastify.patch('/llm/concurrency', async (request, reply) => {
    const body = request.body as { mode?: string } | undefined;
    const mode = body?.mode;
    if (mode !== 'parallel-books' && mode !== 'single-book-speed') {
      return reply.status(400).send({
        error: 'mode 必须是 "parallel-books" 或 "single-book-speed"。',
      });
    }
    try {
      const status = reconfigureWorkers(mode as ConcurrencyMode);
      return { ...status, timestamp: new Date().toISOString() };
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({
        error: '内部错误，请查看服务端日志',
        timestamp: new Date().toISOString(),
      });
    }
  });

  // Test LLM connection
  // 限流：测试连接会真实调用外部 LLM（消耗用户 API 配额/计费），严格限制频率。
  fastify.post('/llm/test', {
    config: { rateLimit: { max: 3, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    try {
      const provider = await getDefaultProvider();
      const isConfigured = await provider.isConfigured();

      if (!isConfigured) {
        return {
          success: false,
          message: 'Provider 未配置。请检查 API Key 和设置。',
          timestamp: new Date().toISOString(),
        };
      }

      // Mock is always "connected"
      if (provider.name === 'mock') {
        return {
          success: true,
          message: 'Mock 模式始终可用。',
          timestamp: new Date().toISOString(),
        };
      }

      // Custom: try a minimal chat request with the actual provider
      try {
        const { z } = await import('zod');
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        try {
          await provider.chatExtract(
            'You are a test assistant. Respond with valid JSON only.',
            'Respond with: {"ok": true}',
            z.object({ ok: z.boolean() })
          );
        } finally {
          clearTimeout(timeoutId);
        }
        return {
          success: true,
          message: '连接成功，API Key 有效。',
          timestamp: new Date().toISOString(),
        };
      } catch (chatErr) {
        // custom provider 现在抛出带 code 的 LLMError，这里据此给出精确提示；
        // 同时把原始报错片段放进 detail，让前端能展示具体原因（区分 base url /
        // key / 模型名 / 网络 / 超时），而不是笼统的"测试失败"。
        const { LLMError } = await import('@novel-agent/llm');
        const code = chatErr instanceof LLMError ? chatErr.code : undefined;
        const msg = chatErr instanceof Error ? chatErr.message : String(chatErr);
        const detail = msg.slice(0, 400);

        if (code === 'AUTH_ERROR' || /401|403|认证失败|unauthorized|api key/i.test(msg)) {
          return {
            success: false,
            message: '认证失败（401/403）。请检查 API Key 是否正确、是否与所选服务商匹配。',
            detail,
            timestamp: new Date().toISOString(),
          };
        }
        if (code === 'MODEL_NOT_FOUND' || /404|模型不存在|model not found/i.test(msg)) {
          return {
            success: false,
            message: '接口或模型不存在（404）。请检查 Base URL（末尾通常为 /v1）与模型名称是否正确。',
            detail,
            timestamp: new Date().toISOString(),
          };
        }
        if (code === 'TIMEOUT' || /超时|timeout|timed out|abort/i.test(msg)) {
          return {
            success: false,
            message: '请求超时。可能是网络不可达，或 Base URL 指向了错误的地址。',
            detail,
            timestamp: new Date().toISOString(),
          };
        }
        if (code === 'RATE_LIMIT' || /429|限流|rate limit/i.test(msg)) {
          return {
            success: false,
            message: '请求被限流（429），稍后重试。',
            detail,
            timestamp: new Date().toISOString(),
          };
        }
        if (code === 'NETWORK_ERROR' || /network|fetch|ECONNREFUSED|ENOTFOUND|getaddrinfo|DNS/i.test(msg)) {
          return {
            success: false,
            message: '网络错误：无法连接到服务端。请检查 Base URL 是否可达、网络/代理设置。',
            detail,
            timestamp: new Date().toISOString(),
          };
        }
        // 兜底：连接可能通了，但响应内容不符合预期（解析失败等）
        return {
          success: false,
          message: '测试失败：连接正常，但响应不符合预期。可能是模型名错误或返回格式不兼容。',
          detail,
          timestamp: new Date().toISOString(),
        };
      }
    } catch (error) {
      // 测试连接的错误信息保留给用户诊断（如认证失败/模型不存在），但记录完整日志便于排查
      request.log.error(error);
      return reply.status(500).send({
        success: false,
        message: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      });
    }
  });
}
