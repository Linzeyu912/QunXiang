import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  getDefaultProvider,
  setRuntimeConfig,
  setRuntimeProvider,
} from './factory.js';

/**
 * 多 Key 单例化（S2）的回归测试。
 *
 * 修改前：resolveProvider 每次 createCustomProvider 新建实例，
 *   custom.ts 的 keyCursor/keyHealth 是闭包局部状态 → 轮询游标每次从 0 开始、
 *   健康摘除从未生效。多 key 并发提取形同虚设。
 * 修改后：factory 缓存 custom provider 单例，配置变化时失效重建。
 */
describe('factory provider 单例化', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // 清掉 env，避免污染指纹；测试统一走 runtimeConfig 路径
    delete process.env.LLM_PROVIDER;
    delete process.env.LLM_API_KEY;
    delete process.env.LLM_API_KEYS;
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_MODEL;
    delete process.env.LLM_MOCK_ENABLED;
    // 每个测试前重置 runtime 状态（单例缓存会随之失效）
    setRuntimeProvider('auto');
    setRuntimeConfig({ provider: 'custom', apiKey: '', apiKeys: [], baseUrl: '', model: '' }, false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const k of Object.keys(process.env)) {
      if (!(k in originalEnv)) delete process.env[k];
    }
    Object.assign(process.env, originalEnv);
  });

  /** 构造一个返回固定 JSON 的 fetch mock，记录每次请求的 Authorization 头 */
  function mockFetchRecordKeys() {
    const usedKeys: string[] = [];
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const auth = (init?.headers as Record<string, string>)?.Authorization ?? '';
      usedKeys.push(auth.replace('Bearer ', ''));
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"value":"ok"}' } }],
      }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    return { fetchMock, usedKeys };
  }

  it('连续两次 getDefaultProvider 返回同一实例（单例）', async () => {
    setRuntimeConfig({
      provider: 'custom',
      apiKeys: ['key-a'],
      baseUrl: 'https://example.test/v1',
      model: 'm',
    }, false);

    const p1 = await getDefaultProvider();
    const p2 = await getDefaultProvider();
    expect(p1).toBe(p2); // 同一引用 → keyCursor/keyHealth 跨调用保留
  });

  it('setRuntimeConfig 改 key 后返回新实例（缓存失效）', async () => {
    setRuntimeConfig({
      provider: 'custom',
      apiKeys: ['key-a'],
      baseUrl: 'https://example.test/v1',
      model: 'm',
    }, false);
    const p1 = await getDefaultProvider();

    setRuntimeConfig({
      provider: 'custom',
      apiKeys: ['key-b'],
      baseUrl: 'https://example.test/v1',
      model: 'm',
    }, false);
    const p2 = await getDefaultProvider();

    expect(p1).not.toBe(p2); // 配置变了 → 重建
  });

  it('多 key 轮询游标跨调用推进（修改前的核心 bug）', async () => {
    const { usedKeys } = mockFetchRecordKeys();
    setRuntimeConfig({
      provider: 'custom',
      apiKeys: ['key-1', 'key-2'],
      baseUrl: 'https://example.test/v1',
      model: 'm',
    }, false);

    // 同一单例 provider 连续调用两次。修改前：每次 new，游标从 0 → 两次都用 key-1。
    // 修改后：游标保留，第二次推进到 key-2。
    const provider = await getDefaultProvider();
    await provider.chatExtract('s', 'u', z.object({ value: z.string() }));
    await provider.chatExtract('s', 'u', z.object({ value: z.string() }));

    expect(usedKeys).toEqual(['key-1', 'key-2']);
  });

  it('多 key 健康摘除状态跨调用保留（修改前的核心 bug）', async () => {
    // key-1 连续 429 三次应被摘除冷却。修改前：每次 new，keyHealth 全空，
    // failCount 永远累加不到阈值。修改后：单例保留状态，第 4 次起避开 key-1。
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const auth = (init?.headers as Record<string, string>)?.Authorization ?? '';
      const key = auth.replace('Bearer ', '');
      // key-1 永远 429，key-2 正常
      if (key === 'key-1') {
        return new Response('rate limited', { status: 429 });
      }
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"value":"ok"}' } }],
      }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    setRuntimeConfig({
      provider: 'custom',
      apiKeys: ['key-1', 'key-2'],
      baseUrl: 'https://example.test/v1',
      model: 'm',
    }, false);

    const provider = await getDefaultProvider();
    // 前几次：pickKey 轮到 key-1 时会 429（markKeyFail 累加），轮到 key-2 成功。
    // 连续 3 次 key-1 失败后，key-1 被摘除，后续 pickKey 只选 key-2。
    // 这里做足够多次调用观察：被摘除后不再有 key-1 出现。
    const usedKeys: string[] = [];
    for (let i = 0; i < 8; i++) {
      try {
        await provider.chatExtract('s', 'u', z.object({ value: z.string() }));
      } catch {
        // key-1 的 429 会抛 RATE_LIMIT（可重试），单次失败可接受
      }
      const auth = (fetchMock.mock.calls[fetchMock.mock.calls.length - 1]?.[1] as RequestInit)?.headers as Record<string, string>;
      usedKeys.push((auth?.Authorization ?? '').replace('Bearer ', ''));
    }
    // key-1 出现次数应有限（达到阈值后被冷却）；最后几次应全是 key-2
    const lastThree = usedKeys.slice(-3);
    expect(lastThree.every((k) => k === 'key-2')).toBe(true);
  });
});
