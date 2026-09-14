import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  getDefaultProvider,
  getRuntimeConfig,
  getMaskedProfiles,
  getRuntimeProfiles,
  getTotalApiKeyCount,
  setRuntimeConfig,
  setRuntimeProfiles,
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

describe('多档案（profiles）解析', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.LLM_PROVIDER;
    delete process.env.LLM_API_KEY;
    delete process.env.LLM_API_KEYS;
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_MODEL;
    delete process.env.LLM_MOCK_ENABLED;
    setRuntimeProvider('auto');
    // 基线：一个默认档案 + 一个独立档案
    setRuntimeProfiles([
      { id: 'p-main', name: '主力', baseUrl: 'https://main.test/v1', model: 'm1', apiKeys: ['key-main-1', 'key-main-2'] },
      { id: 'p-alt', name: '备用', baseUrl: 'https://alt.test/v1', model: 'm2', apiKeys: ['key-alt'] },
    ], 'p-main', false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setRuntimeProfiles([], undefined, false);
    for (const k of Object.keys(process.env)) {
      if (!(k in originalEnv)) delete process.env[k];
    }
    Object.assign(process.env, originalEnv);
  });

  it('指定档案 id 取对应 provider，同档案复用单例、不同档案互不共享', async () => {
    const mainA = await getDefaultProvider('p-main');
    const mainB = await getDefaultProvider('p-main');
    const alt = await getDefaultProvider('p-alt');

    expect(mainA).toBe(mainB);
    expect(mainA).not.toBe(alt);
  });

  it('不传档案 id 等价于默认档案（共享同一单例）', async () => {
    const active = await getDefaultProvider();
    const main = await getDefaultProvider('p-main');
    expect(active).toBe(main);
  });

  it('档案不存在时回退默认档案不抛错', async () => {
    const fallback = await getDefaultProvider('p-deleted');
    const main = await getDefaultProvider('p-main');
    expect(fallback).toBe(main);
  });

  it('指定档案的请求打到该档案的 baseUrl 与 key', async () => {
    const urls: string[] = [];
    const keys: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
      urls.push(String(input));
      keys.push(((init?.headers as Record<string, string>)?.Authorization ?? '').replace('Bearer ', ''));
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"value":"ok"}' } }],
      }), { status: 200 });
    }));

    const alt = await getDefaultProvider('p-alt');
    await alt.chatExtract('s', 'u', z.object({ value: z.string() }));
    expect(urls[0]).toBe('https://alt.test/v1/chat/completions');
    expect(keys[0]).toBe('key-alt');
  });

  it('getMaskedProfiles 脱敏并标注默认档案；key 数汇总', () => {
    const masked = getMaskedProfiles()!;
    expect(masked).toHaveLength(2);
    expect(masked[0]).toMatchObject({ id: 'p-main', name: '主力', isActive: true, keyCount: 2 });
    expect(masked[1]).toMatchObject({ id: 'p-alt', isActive: false, keyCount: 1 });
    // 脱敏：不出现完整 key
    expect(JSON.stringify(masked)).not.toContain('key-main-1');
    expect(JSON.stringify(masked)).not.toContain('key-alt');

    expect(getTotalApiKeyCount()).toBe(3);
  });

  it('runtimeConfig 镜像默认档案，切换默认后镜像跟随', () => {
    expect(getRuntimeConfig()).toMatchObject({
      provider: 'custom',
      baseUrl: 'https://main.test/v1',
      model: 'm1',
    });

    setRuntimeProfiles(getRuntimeProfiles()!, 'p-alt', false);
    expect(getRuntimeConfig()).toMatchObject({
      baseUrl: 'https://alt.test/v1',
      model: 'm2',
    });
  });

  it('档案列表清空后退回单配置路径', () => {
    setRuntimeProfiles([], undefined, false);
    expect(getRuntimeProfiles()).toEqual([]);
    // 不抛错即通过（无配置时由 env/错误路径兜底）
    expect(getTotalApiKeyCount()).toBe(0);
  });
});
