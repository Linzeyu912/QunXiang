/**
 * 出站请求目标防护（SSRF 加固）。
 *
 * 只拦截「不可能承载合法模型/图片服务、只可能被用于内网探测」的目标：
 * - IPv4/IPv6 链路本地地址（169.254.0.0/16、fe80::/10）
 * - 未指定地址 0.0.0.0/8
 * - 云元数据服务主机名（metadata.google.internal 等）
 *
 * 刻意不拦截 127.0.0.1、局域网与自定义端口：本项目是本地优先产品，
 * 本机/局域网的 OpenAI 兼容服务（LM Studio、Ollama、自建网关）是合法配置。
 */

const METADATA_HOSTS = new Set([
  'metadata.google.internal',
  'metadata.goog',
  'metadata.azure.internal',
]);

/** 若目标主机属于被拦截类别，返回中文原因；否则返回 null 放行。 */
export function describeBlockedOutboundHost(host: string): string | null {
  const normalized = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!normalized) return null;
  if (METADATA_HOSTS.has(normalized)) {
    return `目标主机 ${normalized} 是云元数据服务地址，禁止作为模型/图片服务端点`;
  }
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(normalized);
  if (ipv4) {
    const first = parseInt(ipv4[1], 10);
    const second = parseInt(ipv4[2], 10);
    if (first === 169 && second === 254) {
      return `目标地址 ${normalized} 属于链路本地网段（169.254.0.0/16），禁止访问`;
    }
    if (first === 0) {
      return `目标地址 ${normalized} 属于未指定地址段（0.0.0.0/8），禁止访问`;
    }
    return null;
  }
  // IPv6 字面量：fe80::/10 链路本地（fe80 ~ febf 前缀）
  if (normalized.includes(':') && /^fe[89ab][0-9a-f]?:/.test(normalized)) {
    return `目标地址 ${normalized} 属于 IPv6 链路本地网段，禁止访问`;
  }
  return null;
}

export interface OutboundUrlCheck {
  ok: boolean;
  /** ok=false 时的中文原因 */
  reason?: string;
}

/** 校验出站 URL：协议必须为 http/https，主机不得命中被拦截类别。 */
export function checkOutboundUrl(rawUrl: string): OutboundUrlCheck {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, reason: `接口地址无法解析：${rawUrl.slice(0, 120)}` };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: `接口地址协议必须是 http 或 https（当前为 ${parsed.protocol}）` };
  }
  const blockedReason = describeBlockedOutboundHost(parsed.hostname);
  if (blockedReason) return { ok: false, reason: blockedReason };
  return { ok: true };
}

/** 断言出站 URL 合法，不合法抛出携带中文原因的 Error。 */
export function assertSafeOutboundUrl(rawUrl: string, context: string): void {
  const check = checkOutboundUrl(rawUrl);
  if (!check.ok) {
    throw new Error(`${context}：${check.reason}`);
  }
}
