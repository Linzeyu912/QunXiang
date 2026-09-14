import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import {
  getDefaultProvider, setRuntimeProvider, getRuntimeProviderName, setRuntimeConfig,
  getRuntimeConfig, getMaskedConfig, getApiKeyCount, loadPersistedConfig, getDefaultImageProvider,
  getMaskedImageConfig, setRuntimeImageConfig, loadPersistedImageConfig,
  PROVIDER_PRESETS, IMAGE_PROVIDER_PRESETS,
  getMaskedProfiles, getRuntimeProfiles, getActiveProfileId, setRuntimeProfiles,
  getTotalApiKeyCount, normalizeApiKeys,
} from '@qunxiang/llm';
import type { RuntimeLlmConfig, RuntimeImageConfig, LlmProfile } from '@qunxiang/llm';
import { reconfigureWorkers, getConcurrencyStatus, type ConcurrencyMode } from '../services/extraction.service.js';

interface ConnectionTestResult {
  success: boolean;
  message: string;
}

/**
 * 用当前生效配置跑一次最小 LLM 请求，验证配置真实可用。
 * PATCH /llm/config（保存后自动验证）与 POST /llm/test（手动测试）共用。
 *
 * @param profileId 可选：测试指定档案（多服务商）；缺省测试默认档案/env 配置。
 *
 * 判定口径：连接测试的目的是验证「地址/密钥/模型」三元组正确。
 * HTTP 200 但模型返回了纯文本/空内容（解析校验失败）说明接口本身通了，
 * 应判定连接成功并附提示——旧逻辑一律报"连接失败"误导用户重配。
 */
async function runLlmConnectionTest(profileId?: string): Promise<ConnectionTestResult> {
  const provider = await getDefaultProvider(profileId);
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
    // 45 秒：思考类模型（reasoner/思考等级）首 token 可能要数十秒，
    // 15 秒会把可用配置误判为超时。
    const timeoutId = setTimeout(() => controller.abort(), 45000);
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

    // 接口已通、仅返回内容不符合测试 JSON 契约（纯文本/空回复/被网关改写）
    // → 判定连接成功，附提示。识别 LLMError 的 VALIDATION 类消息。
    if (
      lowerMsg.includes('empty response')
      || lowerMsg.includes('failed to parse llm response as json')
      || lowerMsg.includes('结构不符合预期')
    ) {
      return { success: true, message: '连接成功（接口与密钥可用；模型未按测试要求返回 JSON，正式提取通常不受影响）。' };
    }

    // 认证错误
    if (lowerMsg.includes('401') || lowerMsg.includes('unauthorized') || lowerMsg.includes('invalid api key') || lowerMsg.includes('authentication') || lowerMsg.includes('认证失败')) {
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
        thinking: maskedConfig?.thinking || '',
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
        thinking: '',
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
      thinking?: string;
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

    // 思考模式：空串=清除（退回 env/模型默认），否则必须是合法枚举
    if (body.thinking !== undefined && body.thinking !== '') {
      if (!['auto', 'off', 'low', 'high', 'max'].includes(body.thinking)) {
        return reply.status(400).send({ error: 'thinking 参数无效，只允许 auto、off、low、high 或 max。' });
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
      if (body.thinking !== undefined) {
        // 空串=清除，交由 factory 归一为 undefined
        config.thinking = body.thinking === ''
          ? undefined
          : body.thinking as RuntimeLlmConfig['thinking'];
      }

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
        thinking: maskedConfig?.thinking || '',
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

  // ── 服务商配置档案（多服务商支持）──
  // 不同厂商各建一个档案；同一厂商多个 key 填在同一档案内轮询。
  // 启动时旧的 v1 单配置文件已自动迁移为「默认配置」档案，此处统一以档案视角操作。

  fastify.get('/llm/profiles', async () => {
    const profiles = getMaskedProfiles();
    if (profiles) {
      return { profiles, activeProfileId: getActiveProfileId() ?? null };
    }
    // 档案模式未启用（无磁盘配置）：合成单配置视图，首次创建档案时完成迁移
    const masked = getMaskedConfig();
    const keyCount = getApiKeyCount();
    if (masked || keyCount > 0) {
      return {
        profiles: [{
          id: 'default',
          name: '默认配置',
          baseUrl: masked?.baseUrl || '',
          model: masked?.model || '',
          thinking: masked?.thinking || '',
          keyHints: masked?.keyHints || [],
          keyCount,
          isActive: true,
        }],
        activeProfileId: 'default',
      };
    }
    return { profiles: [], activeProfileId: null };
  });

  /** 档案入参校验（与旧 PATCH /llm/config 同一套规则）；返回错误消息或 null。 */
  function validateProfilePayload(body: {
    name?: unknown;
    baseUrl?: unknown;
    model?: unknown;
    apiKeys?: unknown;
    thinking?: unknown;
  }, { requireName }: { requireName: boolean }): string | null {
    const emailLike = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (requireName && (typeof body.name !== 'string' || !body.name.trim())) {
      return '档案名称不能为空。';
    }
    if (body.name !== undefined && typeof body.name === 'string' && body.name.length > 64) {
      return '档案名称过长（上限 64 字符）。';
    }
    if (Array.isArray(body.apiKeys)) {
      for (const raw of body.apiKeys) {
        const k = (raw || '').trim();
        if (!k) continue; // 空串=清除该项，允许
        if (emailLike.test(k)) {
          return 'API Key 看起来像邮箱地址，请检查是否被浏览器自动填充了注册账号。';
        }
        if (/\s/.test(k)) {
          return 'API Key 不应包含空白字符。';
        }
      }
    }
    if (typeof body.model === 'string' && body.model.trim() !== '') {
      if (emailLike.test(body.model.trim())) {
        return '模型名称看起来像邮箱地址，请检查是否被浏览器自动填充了注册账号。';
      }
      if (body.model.length > 128) {
        return '模型名称过长（上限 128 字符）。';
      }
    }
    if (typeof body.baseUrl === 'string' && body.baseUrl.trim() !== '') {
      if (!/^https?:\/\//i.test(body.baseUrl.trim())) {
        return 'Base URL 必须以 http:// 或 https:// 开头。';
      }
    }
    if (body.thinking !== undefined && body.thinking !== '' && !['auto', 'off', 'low', 'high', 'max'].includes(body.thinking as string)) {
      return 'thinking 参数无效，只允许 auto、off、low、high 或 max。';
    }
    return null;
  }

  /** 当前档案列表；档案模式未启用但存在单配置时，把单配置包装成「默认配置」档案。 */
  function currentProfilesWithMigration(): LlmProfile[] {
    const existing = getRuntimeProfiles();
    if (existing && existing.length > 0) return existing.map((p) => ({ ...p }));
    const single = getRuntimeConfig();
    if (single && (single.baseUrl || single.model || normalizeApiKeys(single).length > 0)) {
      return [{
        id: 'default',
        name: '默认配置',
        baseUrl: single.baseUrl,
        model: single.model,
        apiKeys: normalizeApiKeys(single),
        thinking: single.thinking,
      }];
    }
    return [];
  }

  fastify.post('/llm/profiles', async (request, reply) => {
    const body = (request.body ?? {}) as {
      name?: string; baseUrl?: string; model?: string; apiKeys?: string[]; thinking?: string;
    };
    const invalid = validateProfilePayload(body, { requireName: true });
    if (invalid) return reply.status(400).send({ error: invalid });

    try {
      const profiles = currentProfilesWithMigration();
      const profileId = randomUUID();
      const thinking = body.thinking && body.thinking !== ''
        ? body.thinking as LlmProfile['thinking']
        : undefined;
      profiles.push({
        id: profileId,
        name: body.name!.trim(),
        baseUrl: body.baseUrl?.trim() || undefined,
        model: body.model?.trim() || undefined,
        apiKeys: (body.apiKeys ?? []).map((k) => k.trim()).filter(Boolean),
        thinking,
      });
      const activeId = getActiveProfileId() ?? profiles[0]?.id;
      setRuntimeProfiles(profiles, activeId, true);
      setRuntimeProvider('llm');
      const concurrency = reconfigureWorkers(getConcurrencyStatus().mode);

      // 保存后自动验证（不阻断保存），结果作为 warning 返回
      let warning: string | undefined;
      try {
        const testResult = await runLlmConnectionTest(profileId);
        if (!testResult.success) warning = `档案已保存，但连接测试失败：${testResult.message}`;
      } catch {
        // 测试抛错不影响保存
      }
      return {
        profiles: getMaskedProfiles(),
        activeProfileId: getActiveProfileId() ?? null,
        concurrency,
        ...(warning ? { warning } : {}),
      };
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: '内部错误，请查看服务端日志' });
    }
  });

  fastify.patch('/llm/profiles/:profileId', async (request, reply) => {
    const { profileId } = request.params as { profileId: string };
    const body = (request.body ?? {}) as {
      name?: string; baseUrl?: string; model?: string; apiKeys?: string[]; thinking?: string;
    };
    const invalid = validateProfilePayload(body, { requireName: false });
    if (invalid) return reply.status(400).send({ error: invalid });

    const profiles = currentProfilesWithMigration();
    const index = profiles.findIndex((p) => p.id === profileId);
    if (index < 0) return reply.status(404).send({ error: '配置档案不存在。' });

    try {
      const current = profiles[index];
      profiles[index] = {
        ...current,
        name: typeof body.name === 'string' && body.name.trim() ? body.name.trim() : current.name,
        baseUrl: body.baseUrl !== undefined ? (body.baseUrl.trim() || undefined) : current.baseUrl,
        model: body.model !== undefined ? (body.model.trim() || undefined) : current.model,
        // apiKeys 未传=保留现有；传数组（含空数组）=整体替换
        apiKeys: body.apiKeys !== undefined
          ? body.apiKeys.map((k) => k.trim()).filter(Boolean)
          : current.apiKeys,
        thinking: body.thinking !== undefined
          ? (body.thinking === '' ? undefined : body.thinking as LlmProfile['thinking'])
          : current.thinking,
      };
      setRuntimeProfiles(profiles, getActiveProfileId(), true);
      const concurrency = reconfigureWorkers(getConcurrencyStatus().mode);

      let warning: string | undefined;
      try {
        const testResult = await runLlmConnectionTest(profileId);
        if (!testResult.success) warning = `档案已保存，但连接测试失败：${testResult.message}`;
      } catch {
        // 测试抛错不影响保存
      }
      return {
        profiles: getMaskedProfiles(),
        activeProfileId: getActiveProfileId() ?? null,
        concurrency,
        ...(warning ? { warning } : {}),
      };
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: '内部错误，请查看服务端日志' });
    }
  });

  fastify.post('/llm/profiles/:profileId/activate', async (request, reply) => {
    const { profileId } = request.params as { profileId: string };
    const profiles = getRuntimeProfiles();
    if (!profiles || !profiles.some((p) => p.id === profileId)) {
      return reply.status(404).send({ error: '配置档案不存在。' });
    }
    try {
      setRuntimeProfiles(profiles, profileId, true);
      const concurrency = reconfigureWorkers(getConcurrencyStatus().mode);
      return {
        profiles: getMaskedProfiles(),
        activeProfileId: profileId,
        concurrency,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: '内部错误，请查看服务端日志' });
    }
  });

  fastify.delete('/llm/profiles/:profileId', async (request, reply) => {
    const { profileId } = request.params as { profileId: string };
    const profiles = getRuntimeProfiles();
    if (!profiles || !profiles.some((p) => p.id === profileId)) {
      return reply.status(404).send({ error: '配置档案不存在。' });
    }
    if (profiles.length <= 1) {
      return reply.status(409).send({ error: '至少保留一个配置档案。' });
    }
    if (profileId === getActiveProfileId()) {
      return reply.status(409).send({ error: '默认档案不可删除，请先把其他档案设为默认。' });
    }
    try {
      setRuntimeProfiles(profiles.filter((p) => p.id !== profileId), getActiveProfileId(), true);
      const concurrency = reconfigureWorkers(getConcurrencyStatus().mode);
      return { profiles: getMaskedProfiles(), activeProfileId: getActiveProfileId() ?? null, concurrency };
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: '内部错误，请查看服务端日志' });
    }
  });

  // 按档案测试连接（真实调用外部 LLM，限流防滥用）
  fastify.post('/llm/profiles/:profileId/test', {
    config: { rateLimit: { max: 6, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { profileId } = request.params as { profileId: string };
    const profiles = getRuntimeProfiles();
    if (!profiles || !profiles.some((p) => p.id === profileId)) {
      return reply.status(404).send({ error: '配置档案不存在，请先保存档案再测试。' });
    }
    try {
      const result = await runLlmConnectionTest(profileId);
      return { ...result, timestamp: new Date().toISOString() };
    } catch (error) {
      return reply.status(500).send({
        success: false,
        message: error instanceof Error ? error.message : String(error),
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
