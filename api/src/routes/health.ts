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
      provider?: 'ollama' | 'custom' | 'mock';
      apiKey?: string;
      baseUrl?: string;
      model?: string;
    } | undefined;

    if (!body || !body.provider) {
      return reply.status(400).send({
        error: 'Missing required field: provider (ollama | custom | mock)',
      });
    }

    if (!['ollama', 'custom', 'mock'].includes(body.provider)) {
      return reply.status(400).send({
        error: 'Invalid provider. Must be "ollama", "custom", or "mock".',
      });
    }

    try {
      const config: Partial<RuntimeLlmConfig> = {
        provider: body.provider,
      };
      if (body.apiKey !== undefined) config.apiKey = body.apiKey;
      if (body.baseUrl !== undefined) config.baseUrl = body.baseUrl;
      if (body.model !== undefined) config.model = body.model;

      setRuntimeConfig(config, true);

      // Also set runtime provider mode accordingly
      if (body.provider === 'mock') {
        setRuntimeProvider('mock');
      } else {
        setRuntimeProvider('llm');
      }

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

      // Ollama: just check health
      if (provider.name === 'ollama') {
        return {
          success: true,
          message: 'Ollama 正在运行。',
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
