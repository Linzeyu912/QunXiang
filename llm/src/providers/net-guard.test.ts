import { describe, expect, it } from 'vitest';
import { checkOutboundUrl, describeBlockedOutboundHost } from './net-guard.js';
import { createCustomProvider } from './custom.js';

/**
 * 出站地址防护（SSRF 加固）契约：
 * - 合法的公网、本机、局域网模型/图片服务一律放行（本地优先产品的合法配置）；
 * - 只拦截链路本地（169.254.0.0/16、fe80::/10）、未指定地址（0.0.0.0/8）、
 *   云元数据主机名，以及非 http/https 协议（data:、file: 等）。
 */

describe('checkOutboundUrl', () => {
  it('放行公网、本机与局域网地址', () => {
    expect(checkOutboundUrl('https://api.openai.com/v1/chat/completions').ok).toBe(true);
    expect(checkOutboundUrl('http://127.0.0.1:11434/v1/chat/completions').ok).toBe(true);
    expect(checkOutboundUrl('http://localhost:3000/v1').ok).toBe(true);
    expect(checkOutboundUrl('http://192.168.1.5:8080/v1/chat/completions').ok).toBe(true);
    expect(checkOutboundUrl('http://10.0.0.2:9000/v1').ok).toBe(true);
  });

  it('拦截 IPv4 链路本地与未指定地址', () => {
    expect(checkOutboundUrl('http://169.254.169.254/latest/meta-data/').ok).toBe(false);
    expect(checkOutboundUrl('http://0.0.0.0/v1/chat/completions').ok).toBe(false);
  });

  it('拦截 IPv6 链路本地与云元数据主机名', () => {
    expect(checkOutboundUrl('http://[fe80::1]/v1/chat/completions').ok).toBe(false);
    expect(checkOutboundUrl('http://metadata.google.internal/computeMetadata/v1/').ok).toBe(false);
  });

  it('拦截非 http/https 协议与非法 URL', () => {
    expect(checkOutboundUrl('data:text/html;base64,xxx').ok).toBe(false);
    expect(checkOutboundUrl('file:///etc/passwd').ok).toBe(false);
    expect(checkOutboundUrl('not a url').ok).toBe(false);
  });

  it('describeBlockedOutboundHost 对放行地址返回 null', () => {
    expect(describeBlockedOutboundHost('api.deepseek.com')).toBeNull();
    expect(describeBlockedOutboundHost('127.0.0.1')).toBeNull();
    expect(describeBlockedOutboundHost('169.254.169.254')).toContain('169.254');
  });
});

describe('custom provider 外部中止信号', () => {
  it('已中止的信号让请求立即失败并映射为超时类错误', async () => {
    const provider = createCustomProvider({
      apiKey: 'sk-test-key-123456',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o',
    });
    const controller = new AbortController();
    controller.abort();
    await expect(
      provider.chatExtract('s', 'u', { parse: () => ({ ok: true }) } as never, { signal: controller.signal }),
    ).rejects.toThrow(/中止|超时/);
  });

  it('生图/模型端点指向链路本地地址时直接拒绝', async () => {
    const provider = createCustomProvider({
      apiKey: 'sk-test-key-123456',
      baseUrl: 'http://169.254.169.254/v1',
      model: 'gpt-4o',
    });
    await expect(
      provider.chatExtract('s', 'u', { parse: () => ({ ok: true }) } as never),
    ).rejects.toThrow(/169\.254|链路本地/);
  });
});
