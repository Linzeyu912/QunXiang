import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createCustomProvider, normalizeApiUrl } from './custom.js';

describe('normalizeApiUrl', () => {
  it('完整端点与含 chat 关键词的地址原样保留', () => {
    expect(normalizeApiUrl('https://api.x.com/v1/chat/completions', 'chat/completions'))
      .toBe('https://api.x.com/v1/chat/completions');
    expect(normalizeApiUrl('https://gw.x.com/api/chat/v2', 'chat/completions'))
      .toBe('https://gw.x.com/api/chat/v2');
  });

  it('版本号根地址追加端点（含 v1beta 这类字母后缀）', () => {
    expect(normalizeApiUrl('https://api.x.com/v1', 'chat/completions'))
      .toBe('https://api.x.com/v1/chat/completions');
    expect(normalizeApiUrl('https://generativelanguage.googleapis.com/v1beta/openai', 'chat/completions'))
      .toBe('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
  });

  it('裸域名（路径 ≤1 段）补 /v1/端点', () => {
    expect(normalizeApiUrl('https://oneapi.example.com', 'chat/completions'))
      .toBe('https://oneapi.example.com/v1/chat/completions');
    expect(normalizeApiUrl('https://api.x.com/api', 'chat/completions'))
      .toBe('https://api.x.com/api/v1/chat/completions');
  });

  it('网关前缀地址（≥2 段、末段非版本号）追加端点而非原样发送', () => {
    // 旧逻辑在此原样发送 → 必然 404（Google 预设自己就中招）
    expect(normalizeApiUrl('https://gw.example.com/api/llm', 'chat/completions'))
      .toBe('https://gw.example.com/api/llm/chat/completions');
    expect(normalizeApiUrl('https://oneapi.example.com/api/openai', 'chat/completions'))
      .toBe('https://oneapi.example.com/api/openai/chat/completions');
  });

  it('末尾斜杠被合并', () => {
    expect(normalizeApiUrl('https://api.x.com/v1/', 'chat/completions'))
      .toBe('https://api.x.com/v1/chat/completions');
  });
});

describe('createCustomProvider', () => {
  afterEach(() => {
    delete process.env.LLM_JSON_MODE;
    delete process.env.LLM_DISABLE_THINKING;
    vi.unstubAllGlobals();
  });

  it('extracts the first JSON object when the model prefixes an unclosed think block', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: '<think>reasoning text that was not closed\n{"value":"ok"}',
        },
      }],
    }), { status: 200 })));

    const provider = createCustomProvider({
      apiKey: process.env.TEST_LLM_API_KEY ?? ['test', 'key'].join('-'),
      baseUrl: 'https://example.test/v1/chat/completions',
      model: 'test-model',
    });
    const result = await provider.chatExtract(
      'system',
      'user',
      z.object({ value: z.string() })
    );

    expect(result).toEqual({ value: 'ok' });
  });

  it('sends OpenAI-compatible JSON mode when LLM_JSON_MODE is enabled', async () => {
    process.env.LLM_JSON_MODE = '1';
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"value":"ok"}' } }],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = createCustomProvider({
      apiKey: process.env.TEST_LLM_API_KEY ?? ['test', 'key'].join('-'),
      baseUrl: 'https://example.test/v1/chat/completions',
      model: 'test-model',
    });
    await provider.chatExtract('system', 'user', z.object({ value: z.string() }));

    const callArgs = fetchMock.mock.calls[0] as unknown[];
    const body = JSON.parse(String((callArgs[1] as { body?: string } | undefined)?.body ?? '{}'));
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('仅在兼容接口开关启用时关闭隐藏推理', async () => {
    process.env.LLM_DISABLE_THINKING = 'true';
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"value":"ok"}' } }],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = createCustomProvider({
      apiKey: process.env.TEST_LLM_API_KEY ?? ['test', 'key'].join('-'),
      baseUrl: 'https://example.test/v1/chat/completions',
      model: 'test-model',
    });
    await provider.chatExtract('system', 'user', z.object({ value: z.string() }));

    const callArgs = fetchMock.mock.calls[0] as unknown[];
    const body = JSON.parse(String((callArgs[1] as { body?: string } | undefined)?.body ?? '{}'));
    expect(body.thinking).toEqual({ type: 'disabled' });
  });

  it('思考等级发送 reasoning_effort 且不带关闭参数', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"value":"ok"}' } }],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = createCustomProvider({
      apiKey: process.env.TEST_LLM_API_KEY ?? ['test', 'key'].join('-'),
      baseUrl: 'https://example.test/v1/chat/completions',
      model: 'glm-5.3-test-level',
      thinking: 'low',
    });
    await provider.chatExtract('system', 'user', z.object({ value: z.string() }));

    const callArgs = fetchMock.mock.calls[0] as unknown[];
    const body = JSON.parse(String((callArgs[1] as { body?: string } | undefined)?.body ?? '{}'));
    expect(body.reasoning_effort).toBe('low');
    expect(body.thinking).toBeUndefined();
  });

  it('显式配置 auto 覆盖 env 的关闭思考', async () => {
    process.env.LLM_DISABLE_THINKING = '1';
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"value":"ok"}' } }],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = createCustomProvider({
      apiKey: process.env.TEST_LLM_API_KEY ?? ['test', 'key'].join('-'),
      baseUrl: 'https://example.test/v1/chat/completions',
      model: 'test-auto-model',
      thinking: 'auto',
    });
    await provider.chatExtract('system', 'user', z.object({ value: z.string() }));

    const callArgs = fetchMock.mock.calls[0] as unknown[];
    const body = JSON.parse(String((callArgs[1] as { body?: string } | undefined)?.body ?? '{}'));
    expect(body.thinking).toBeUndefined();
    expect(body.reasoning_effort).toBeUndefined();
  });

  it('不支持 reasoning_effort 的模型去掉参数重试', async () => {
    const rejection = new Response(JSON.stringify({
      error: { message: 'Invalid parameter: reasoning_effort is not supported for this model.' },
    }), { status: 400 });
    const success = () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"value":"ok"}' } }],
    }), { status: 200 });
    const fetchMock = vi.fn()
      .mockImplementationOnce(async () => rejection)
      .mockImplementation(async () => success());
    vi.stubGlobal('fetch', fetchMock);

    const provider = createCustomProvider({
      apiKey: process.env.TEST_LLM_API_KEY ?? ['test', 'key'].join('-'),
      baseUrl: 'https://example.test/v1/chat/completions',
      model: 'no-effort-model-test',
      thinking: 'high',
    });
    const result = await provider.chatExtract('system', 'user', z.object({ value: z.string() }));
    expect(result).toEqual({ value: 'ok' });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const retryBody = JSON.parse(String(
      ((fetchMock.mock.calls[1] as unknown[])[1] as { body?: string } | undefined)?.body ?? '{}',
    ));
    expect(retryBody.reasoning_effort).toBeUndefined();
  });

  it('固定 temperature 的模型（如 Kimi K3）报 400 点名后剔除重试', async () => {
    const rejection = new Response(JSON.stringify({
      error: { message: 'Invalid request: temperature is fixed to 1.0 for this model.' },
    }), { status: 400 });
    const success = () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"value":"ok"}' } }],
    }), { status: 200 });
    const fetchMock = vi.fn()
      .mockImplementationOnce(async () => rejection)
      .mockImplementation(async () => success());
    vi.stubGlobal('fetch', fetchMock);

    const provider = createCustomProvider({
      apiKey: process.env.TEST_LLM_API_KEY ?? ['test', 'key'].join('-'),
      baseUrl: 'https://example.test/v1/chat/completions',
      model: 'kimi-k3-test',
    });
    const result = await provider.chatExtract('system', 'user', z.object({ value: z.string() }));
    expect(result).toEqual({ value: 'ok' });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const retryBody = JSON.parse(String(
      ((fetchMock.mock.calls[1] as unknown[])[1] as { body?: string } | undefined)?.body ?? '{}',
    ));
    expect(retryBody.temperature).toBeUndefined();
  });

  it('规范化地址命中 404 时用原样地址重试一次，成功后沿用原样地址', async () => {
    // 场景：少数网关只认用户原始路径（…/gw/llm），规范化追加 /v1/chat/completions 反而 404
    const rawBaseUrl = 'https://gw.example.com/llm';
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url === 'https://gw.example.com/llm/v1/chat/completions') {
        return new Response('not found', { status: 404 });
      }
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"value":"ok"}' } }],
      }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = createCustomProvider({
      apiKey: process.env.TEST_LLM_API_KEY ?? ['test', 'key'].join('-'),
      baseUrl: rawBaseUrl,
      model: 'gateway-model-test',
    });
    const result = await provider.chatExtract('system', 'user', z.object({ value: z.string() }));
    expect(result).toEqual({ value: 'ok' });
    // 第一次规范化地址 404 → 第二次原样地址成功
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://gw.example.com/llm/v1/chat/completions');
    expect(String(fetchMock.mock.calls[1][0])).toBe('https://gw.example.com/llm');
    // 记住有效形态：后续调用直接打原样地址，不再先撞 404
    await provider.chatExtract('system', 'user', z.object({ value: z.string() }));
    expect(String(fetchMock.mock.calls[2][0])).toBe('https://gw.example.com/llm');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('始终思考模型拒绝关闭思考时去掉参数重试，之后不再发送该参数（智谱 1210）', async () => {
    process.env.LLM_DISABLE_THINKING = '1';
    const rejection = new Response(JSON.stringify({
      error: { code: 1210, message: '该模型始终思考，不支持关闭思考；请使用 low、high 或 max。' },
    }), { status: 400 });
    const success = () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"value":"ok"}' } }],
    }), { status: 200 });
    const fetchMock = vi.fn()
      .mockImplementationOnce(async () => rejection)
      .mockImplementation(async () => success());
    vi.stubGlobal('fetch', fetchMock);

    const provider = createCustomProvider({
      apiKey: process.env.TEST_LLM_API_KEY ?? ['test', 'key'].join('-'),
      baseUrl: 'https://example.test/v1/chat/completions',
      model: 'glm-5.3-test',
    });
    const result = await provider.chatExtract('system', 'user', z.object({ value: z.string() }));
    expect(result).toEqual({ value: 'ok' });

    // 第一次带关闭参数被拒；第二次请求必须已去掉 thinking
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retryBody = JSON.parse(String(
      ((fetchMock.mock.calls[1] as unknown[])[1] as { body?: string } | undefined)?.body ?? '{}',
    ));
    expect(retryBody.thinking).toBeUndefined();

    // 再次调用：模型已被记住，直接不带 thinking 参数（无需再挨一次 400）
    await provider.chatExtract('system', 'user', z.object({ value: z.string() }));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const thirdBody = JSON.parse(String(
      ((fetchMock.mock.calls[2] as unknown[])[1] as { body?: string } | undefined)?.body ?? '{}',
    ));
    expect(thirdBody.thinking).toBeUndefined();
  });
});
