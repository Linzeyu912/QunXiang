import type { FastifyInstance } from 'fastify';
import { getDefaultProvider, setRuntimeProvider, getRuntimeProviderName, setRuntimeConfig, getMaskedConfig, loadPersistedConfig } from '@novel-agent/llm';
import type { RuntimeLlmConfig } from '@novel-agent/llm';

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

  // Configure LLM provider (API Key, Base URL, Model)
  fastify.patch('/llm/config', async (request, reply) => {
    const body = request.body as {
      provider?: 'custom';
      apiKey?: string;
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

    // 基本合理性校验：拦截浏览器自动填充串进来的注册账号/密码。
    // 注册邮箱常被 autofill 填进"模型名"框、注册密码填进 API Key 框，
    // 这些值格式明显异常，在此挡住并给前端明确错误，避免错误配置被静默存盘。
    const emailLike = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (body.model !== undefined && body.model.trim() !== '') {
      if (emailLike.test(body.model.trim())) {
        return reply.status(400).send({
          error: '模型名称看起来像邮箱地址，请检查是否被浏览器自动填充了注册账号。',
        });
      }
      if (body.model.length > 128) {
        return reply.status(400).send({ error: '模型名称过长（上限 128 字符）。' });
      }
    }

    if (body.apiKey !== undefined && body.apiKey.trim() !== '') {
      // API Key 不应是邮箱形态，也不应含空白（合法 key 不会带空格/换行）。
      if (emailLike.test(body.apiKey.trim())) {
        return reply.status(400).send({
          error: 'API Key 看起来像邮箱地址，请检查是否被浏览器自动填充了注册账号。',
        });
      }
      if (/\s/.test(body.apiKey)) {
        return reply.status(400).send({ error: 'API Key 不应包含空白字符。' });
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
      if (body.apiKey !== undefined) config.apiKey = body.apiKey;
      if (body.baseUrl !== undefined) config.baseUrl = body.baseUrl;
      if (body.model !== undefined) config.model = body.model;

      setRuntimeConfig(config, true);

      setRuntimeProvider('llm');

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
      return reply.status(500).send({
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      });
    }
  });

  // Test LLM connection
  fastify.post('/llm/test', async (request, reply) => {
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
        const msg = chatErr instanceof Error ? chatErr.message : String(chatErr);
        if (msg.includes('401') || msg.includes('auth') || msg.includes('API key') || msg.includes('Authentication')) {
          return {
            success: false,
            message: '认证失败，请检查 API Key。',
            timestamp: new Date().toISOString(),
          };
        }
        if (msg.includes('404') || msg.includes('model')) {
          return {
            success: false,
            message: '模型不存在，请检查模型名称。',
            timestamp: new Date().toISOString(),
          };
        }
        if (msg.includes('network') || msg.includes('fetch') || msg.includes('ECONNREFUSED') || msg.includes('abort')) {
          return {
            success: false,
            message: `网络错误：${msg.substring(0, 100)}`,
            timestamp: new Date().toISOString(),
          };
        }
        // Other errors — connection works but something else failed
        return {
          success: false,
          message: `测试失败：${msg.substring(0, 150)}`,
          timestamp: new Date().toISOString(),
        };
      }
    } catch (error) {
      return reply.status(500).send({
        success: false,
        message: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      });
    }
  });
}
