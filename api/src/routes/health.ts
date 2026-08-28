import type { FastifyInstance } from 'fastify';
import { getDefaultProvider, setRuntimeProvider, getRuntimeProviderName, setRuntimeConfig, getMaskedConfig, getApiKeyCount, loadPersistedConfig, getDefaultImageProvider, getMaskedImageConfig, setRuntimeImageConfig, loadPersistedImageConfig, PROVIDER_PRESETS, IMAGE_PROVIDER_PRESETS } from '@qunxiang/llm';
import type { RuntimeLlmConfig, RuntimeImageConfig } from '@qunxiang/llm';
import { reconfigureWorkers, getConcurrencyStatus, type ConcurrencyMode } from '../services/extraction.service.js';

interface ConnectionTestResult {
  success: boolean;
  message: string;
}

/**
 * 用当前生效配置跑一次最小 LLM 请求，验证配置真实可用。
 * PATCH /llm/config（保存后自动验证）与 POST /llm/test（手动测试）共用。
 */
async function runLlmConnectionTest(): Promise<ConnectionTestResult> {
  const provider = await getDefaultProvider();
  const isConfigured = await provider.isConfigured();

  if (!isConfigured) {
    return { success: false, message: 'Provider 未配置。请检查 API Key 和设置。' };
  }

  // Mock is always "connected"
  if (provider.name === 'mock') {
    return { success: true, message: 'Mock 模式始终可用。' };
  }

  // Custom: try a minimal chat request with the actual provider
  try {
    const { z } = await import('zod');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15秒超时
    try {
      // 信号传入 provider：中止时底层 fetch 立即失败，而不是挂满 provider
      // 自身的 600 秒超时（此前的 AbortController 是无效的死代码）。
      await provider.chatExtract(
        'You are a test assistant. Respond with valid JSON only.',
        'Respond with: {"ok": true}',
        z.object({ ok: z.boolean() }),
        { signal: controller.signal },
      );
    } finally {
      clearTimeout(timeoutId);
    }
    return { success: true, message: '连接成功，API Key 有效。' };
  } catch (chatErr) {
    const msg = chatErr instanceof Error ? chatErr.message : String(chatErr);
    const lowerMsg = msg.toLowerCase();
    
    // 认证错误
    if (lowerMsg.includes('401') || lowerMsg.includes('unauthorized') || lowerMsg.includes('invalid api key') || lowerMsg.includes('authentication')) {
      return { success: false, message: 'API Key 无效或已过期，请检查密钥是否正确。' };
    }
    
    // 权限错误
    if (lowerMsg.includes('403') || lowerMsg.includes('forbidden') || lowerMsg.includes('permission')) {
      return { success: false, message: 'API Key 权限不足，请检查是否已开通该模型的访问权限。' };
    }
    
    // 限流错误
    if (lowerMsg.includes('429') || lowerMsg.includes('rate limit') || lowerMsg.includes('too many requests')) {
      return { success: false, message: '请求频率超限，请稍后重试或检查账户额度。' };
    }
    
    // 超时错误（含 provider 抛出的中文「超时/中止」消息）
    if (lowerMsg.includes('timeout') || lowerMsg.includes('timed out') || lowerMsg.includes('abort') || msg.includes('超时') || msg.includes('中止')) {
      return { success: false, message: '连接超时，请检查网络或稍后重试。' };
    }
    
    // 网络错误
    if (lowerMsg.includes('enotfound') || lowerMsg.includes('getaddrinfo') || lowerMsg.includes('dns')) {
      return { success: false, message: '无法解析服务器地址，请检查网络连接。' };
    }
    if (lowerMsg.includes('econnrefused') || lowerMsg.includes('connection refused')) {
      return { success: false, message: '服务器拒绝连接，请检查接口地址是否正确。' };
    }
    if (lowerMsg.includes('network') || lowerMsg.includes('fetch') || lowerMsg.includes('econnreset')) {
      return { success: false, message: '网络连接失败，请检查网络设置。' };
    }
    
    // 404 错误
    if (lowerMsg.includes('404') || lowerMsg.includes('not found')) {
      return { success: false, message: '接口地址错误（404），请检查接口地址是否正确。' };
    }
    
    // 模型错误
    if (lowerMsg.includes('model') && (lowerMsg.includes('not found') || lowerMsg.includes('does not exist') || lowerMsg.includes('invalid'))) {
      return { success: false, message: '模型不存在或已下线，请选择其他模型。' };
    }
    
    // 余额不足
    if (lowerMsg.includes('balance') || lowerMsg.includes('quota') || lowerMsg.includes('insufficient')) {
      return { success: false, message: '账户余额不足或配额已用完，请充值后重试。' };
    }
    
    // 其他错误
    return { success: false, message: `连接失败：${msg.substring(0, 100)}` };
  }
}

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
  try {
    loadPersistedImageConfig();
  } catch (err) {
    console.warn('[health] Failed to load persisted image config:', err instanceof Error ? err.message : String(err));
  }

  // Basic health check
  fastify.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // LLM provider presets (for frontend dropdown)
  fastify.get('/llm/presets', async () => {
    return { presets: PROVIDER_PRESETS };
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
        error: 'provider 参数无效，只允许 llm、mock 或 auto',
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
        error: '缺少必填字段：provider（custom）',
      });
    }

    if (body.provider !== 'custom') {
      return reply.status(400).send({
        error: 'provider 参数无效，只允许 custom',
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

      // 保存后自动验证：配置格式合法不代表可用（如 baseUrl 指向错误路径 → 404）。
      // 不阻断保存（用户可能先存后改），但把测试结果作为 warning 返回给前端提示。
      let warning: string | undefined;
      if (isConfigured) {
        const testResult = await runLlmConnectionTest();
        if (!testResult.success) {
          warning = `配置已保存，但连接测试失败：${testResult.message}`;
        }
      }

      return {
        provider: providerName,
        configured: isConfigured,
        canExtract: isConfigured,
        keyHint: maskedConfig?.keyHint || '',
        keyHints: maskedConfig?.keyHints || [],
        keyCount: getApiKeyCount(),
        baseUrl: maskedConfig?.baseUrl || '',
        model: maskedConfig?.model || '',
        ...(warning ? { warning } : {}),
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
      const result = await runLlmConnectionTest();
      return {
        ...result,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return reply.status(500).send({
        success: false,
        message: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      });
    }
  });

  // Image provider presets (for frontend dropdown)
  fastify.get('/image/presets', async () => {
    return { presets: IMAGE_PROVIDER_PRESETS };
  });

  // ── Image generation provider status ──
  fastify.get('/image', async (_request, reply) => {
    try {
      const provider = getDefaultImageProvider();
      const isConfigured = await provider.isConfigured();
      const maskedConfig = getMaskedImageConfig();

      return {
        provider: 'custom',
        configured: isConfigured,
        keyHint: maskedConfig?.keyHint || '',
        baseUrl: maskedConfig?.baseUrl || '',
        model: maskedConfig?.model || '',
        size: maskedConfig?.size || '',
        characterRatio: maskedConfig?.characterRatio || '',
        itemRatio: maskedConfig?.itemRatio || '',
        locationRatio: maskedConfig?.locationRatio || '',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return reply.status(503).send({
        provider: 'none',
        configured: false,
        keyHint: '',
        baseUrl: '',
        model: '',
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      });
    }
  });

  // ── Configure image generation provider ──
  fastify.patch('/image/config', async (request, reply) => {
    const body = request.body as {
      apiKey?: string;
      baseUrl?: string;
      model?: string;
      size?: string;
      characterRatio?: string;
      itemRatio?: string;
      locationRatio?: string;
    } | undefined;

    if (!body) {
      return reply.status(400).send({ error: '缺少请求体' });
    }

    // Basic validation (same as LLM)
    const emailLike = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (body.model !== undefined && body.model.trim() !== '') {
      if (emailLike.test(body.model.trim())) {
        return reply.status(400).send({ error: '模型名称看起来像邮箱地址，请检查是否被浏览器自动填充了注册账号。' });
      }
    }
    if (body.apiKey !== undefined && body.apiKey.trim() !== '') {
      if (emailLike.test(body.apiKey.trim())) {
        return reply.status(400).send({ error: 'API Key 看起来像邮箱地址，请检查是否被浏览器自动填充了注册账号。' });
      }
      if (/\s/.test(body.apiKey)) {
        return reply.status(400).send({ error: 'API Key 不应包含空白字符。' });
      }
    }
    if (body.baseUrl !== undefined && body.baseUrl.trim() !== '') {
      if (!/^https?:\/\//i.test(body.baseUrl.trim())) {
        return reply.status(400).send({ error: 'Base URL 必须以 http:// 或 https:// 开头。' });
      }
    }

    try {
      const config: Partial<RuntimeImageConfig> = { provider: 'custom' };
      if (body.apiKey !== undefined) config.apiKey = body.apiKey;
      if (body.baseUrl !== undefined) config.baseUrl = body.baseUrl;
      if (body.model !== undefined) config.model = body.model;
      if (body.size !== undefined) config.size = body.size;
      if (body.characterRatio !== undefined) config.characterRatio = body.characterRatio;
      if (body.itemRatio !== undefined) config.itemRatio = body.itemRatio;
      if (body.locationRatio !== undefined) config.locationRatio = body.locationRatio;

      setRuntimeImageConfig(config);

      const provider = getDefaultImageProvider();
      const isConfigured = await provider.isConfigured();
      const maskedConfig = getMaskedImageConfig();

      return {
        provider: 'custom',
        configured: isConfigured,
        keyHint: maskedConfig?.keyHint || '',
        baseUrl: maskedConfig?.baseUrl || '',
        model: maskedConfig?.model || '',
        size: maskedConfig?.size || '',
        characterRatio: maskedConfig?.characterRatio || '',
        itemRatio: maskedConfig?.itemRatio || '',
        locationRatio: maskedConfig?.locationRatio || '',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return reply.status(500).send({
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      });
    }
  });

  // ── Test image generation connection ──
  // 限流：与 /llm/test 对齐——测试会真实调用生图服务（计费），严格限制频率。
  fastify.post('/image/test', {
    config: { rateLimit: { max: 3, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    try {
      const provider = getDefaultImageProvider();
      const isConfigured = await provider.isConfigured();

      if (!isConfigured) {
        return {
          success: false,
          message: '图片服务商未配置。请在下方填写 API Key、Base URL 和模型名称。',
          timestamp: new Date().toISOString(),
        };
      }

      // Try a minimal image generation to verify
      try {
        const result = await provider.generateImage('a simple red circle on white background', { aspectRatio: '1:1' });
        const ok = result.buffer.length > 100; // sanity check
        return {
          success: ok,
          message: ok
            ? `连接成功！测试图片 ${(result.buffer.length / 1024).toFixed(1)} KB`
            : '生图返回空结果，请检查模型名称。',
          timestamp: new Date().toISOString(),
        };
      } catch (genErr) {
        const msg = genErr instanceof Error ? genErr.message : String(genErr);
        if (msg.includes('401') || msg.includes('auth') || msg.includes('API key')) {
          return { success: false, message: '认证失败，请检查 API Key。', timestamp: new Date().toISOString() };
        }
        if (msg.includes('404') || msg.includes('page not found')) {
          return { success: false, message: '接口返回 404：通常是「接口地址」路径不对（如缺少 /v1），请到设置页核对。', timestamp: new Date().toISOString() };
        }
        if (msg.includes('model')) {
          return { success: false, message: '模型不存在，请检查模型名称。', timestamp: new Date().toISOString() };
        }
        return { success: false, message: `测试失败：${msg.substring(0, 150)}`, timestamp: new Date().toISOString() };
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
