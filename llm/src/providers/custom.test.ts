import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createCustomProvider } from './custom.js';

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
      apiKey: 'test-key',
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
      apiKey: 'test-key',
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
      apiKey: 'test-key',
      baseUrl: 'https://example.test/v1/chat/completions',
      model: 'test-model',
    });
    await provider.chatExtract('system', 'user', z.object({ value: z.string() }));

    const callArgs = fetchMock.mock.calls[0] as unknown[];
    const body = JSON.parse(String((callArgs[1] as { body?: string } | undefined)?.body ?? '{}'));
    expect(body.thinking).toEqual({ type: 'disabled' });
  });
});
