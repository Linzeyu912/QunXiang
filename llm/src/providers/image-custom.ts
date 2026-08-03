import { LLMError, ProviderNotConfiguredError } from '../errors.js';
import { normalizeApiUrl } from './custom.js';
// 必须用 undici 自己的 fetch（不能用全局 fetch）：ProxyAgent 是 undici 的 dispatcher，
// 和 Node 内置 undici 的全局 fetch 版本不兼容（报 invalid onRequestStart method）。
import { fetch as undiciFetch, ProxyAgent, Agent, buildConnector } from 'undici';
import type { Dispatcher } from 'undici';
import { SocksClient } from 'socks';
import { Socket } from 'net';
import { execSync } from 'child_process';
import type { ImageProvider } from '../index.js';

export interface ImageCustomConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  /** 图片尺寸（Seedream/OpenAI 风格，如 "2K"/"1024x1024"），优先于 aspect_ratio */
  size?: string;
  timeout?: number;
}

const DEFAULT_TIMEOUT = 120000; // 2 minutes for image generation

// ── SOCKS5 代理自动检测 ──

/** 常见代理软件的 SOCKS5 端口 */
const COMMON_SOCKS5_PORTS = [
  { port: 7891, name: 'Clash (mixed)' },
  { port: 7892, name: 'Clash (SOCKS5)' },
  { port: 10808, name: 'V2Ray' },
  { port: 1080, name: 'Shadowsocks / 通用' },
  { port: 6153, name: 'Surge' },
  { port: 2080, name: 'ClashX' },
];

/**
 * 读取 Windows 系统代理端口（注册表）。
 * Clash/V2Ray 等开启"系统代理"时会写入此注册表项。
 * 返回端口号，未设置则返回 null。
 */
function getWindowsSystemProxyPort(): number | null {
  if (process.platform !== 'win32') return null;
  try {
    const output = execSync(
      'powershell -Command "Get-ItemProperty \'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings\' | Select-Object -ExpandProperty ProxyServer"',
      { encoding: 'utf8', timeout: 2000, stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim();
    if (!output) return null;
    // 格式: "127.0.0.1:7897" 或 "http=127.0.0.1:7897;https=127.0.0.1:7897"
    const match = output.match(/:(\d+)$/);
    if (match) return parseInt(match[1], 10);
    return null;
  } catch {
    return null;
  }
}

/**
 * 读取 Windows 系统代理设置（注册表）。
 * 返回格式如 "http://127.0.0.1:7897"，未设置则返回 null。
 */
function getWindowsSystemProxy(): string | null {
  const port = getWindowsSystemProxyPort();
  if (port) return `http://127.0.0.1:${port}`;
  return null;
}

/**
 * 检测本地 SOCKS5 代理：尝试连接常见端口，返回第一个可用的。
 * 仅探测 localhost，耗时 < 100ms（每个端口 50ms 超时）。
 * 优先检测 Windows 系统代理端口（Clash/V2Ray 开启系统代理时写入注册表）。
 */
async function detectLocalSocks5(): Promise<string | null> {
  // Windows 系统代理端口优先（Clash/V2Ray 的"系统代理"模式）
  const sysProxyPort = getWindowsSystemProxyPort();
  const portsToCheck = sysProxyPort
    ? [{ port: sysProxyPort, name: '系统代理' }, ...COMMON_SOCKS5_PORTS.filter(p => p.port !== sysProxyPort)]
    : COMMON_SOCKS5_PORTS;

  for (const { port, name } of portsToCheck) {
    try {
      const reachable = await new Promise<boolean>((resolve) => {
        const socket = new Socket();
        const timer = setTimeout(() => {
          socket.destroy();
          resolve(false);
        }, 50);
        socket.connect(port, '127.0.0.1', () => {
          clearTimeout(timer);
          socket.destroy();
          resolve(true);
        });
        socket.on('error', () => {
          clearTimeout(timer);
          resolve(false);
        });
      });
      if (reachable) {
        const url = `socks5://127.0.0.1:${port}`;
        console.log(`[image-provider] 自动检测到 SOCKS5 代理: ${url} (${name})`);
        return url;
      }
    } catch {
      // 继续探测下一个端口
    }
  }
  return null;
}

// ── 代理 Dispatcher 管理 ──

let cachedProxyDispatcher: Dispatcher | null | undefined = undefined;
let cachedProxyUrl: string | undefined = undefined;

/**
 * 创建 SOCKS5 的 undici Dispatcher。
 * 通过 socks 包建立隧道，获取原始 TCP Socket，传给 undici 的 Agent。
 */
function createSocks5Dispatcher(proxyUrl: string): Dispatcher {
  const parsed = new URL(proxyUrl);
  const proxyHost = parsed.hostname;
  const proxyPort = parseInt(parsed.port, 10) || 1080;
  const username = parsed.username || undefined;
  const password = parsed.password || undefined;

  const defaultConnector = buildConnector({});

  const socksConnector: ReturnType<typeof buildConnector> = (opts, callback) => {
    const { hostname, port } = new URL(opts.hostname.startsWith('http') ? opts.hostname : `https://${opts.hostname}:${opts.port || 443}`);
    const targetHost = hostname;
    const targetPort = Number(port) || 443;

    SocksClient.createConnection({
      proxy: {
        host: proxyHost,
        port: proxyPort,
        type: 5,
        ...(username && password ? { userId: username, password } : {}),
      },
      command: 'connect',
      destination: {
        host: targetHost,
        port: targetPort,
      },
    }).then(({ socket }) => {
      // SOCKS5 隧道建立成功，把 socket 传给 undici 的默认 connector 处理 TLS
      (defaultConnector as any)({ ...opts, httpSocket: socket as any }, callback);
    }).catch((err) => {
      callback(err instanceof Error ? err : new Error(String(err)), null as any);
    });
  };

  return new Agent({ connect: socksConnector });
}

/**
 * 获取图片请求的代理 Dispatcher。
 *
 * 优先级：
 * 1. IMAGE_PROXY 环境变量（用户显式配置）
 * 2. 自动检测本地 SOCKS5 代理端口
 * 3. 无代理直连
 */
async function getProxyDispatcher(): Promise<{ dispatcher?: Dispatcher }> {
  // 用户显式配置优先
  const envProxy = process.env.IMAGE_PROXY;

  if (envProxy) {
    // 用户配置了代理
    if (cachedProxyUrl === envProxy && cachedProxyDispatcher !== undefined) {
      return cachedProxyDispatcher ? { dispatcher: cachedProxyDispatcher } : {};
    }

    cachedProxyUrl = envProxy;
    try {
      if (/^socks5h?:\/\//i.test(envProxy)) {
        cachedProxyDispatcher = createSocks5Dispatcher(envProxy);
      } else {
        cachedProxyDispatcher = new ProxyAgent(envProxy);
      }
      console.log(`[image-provider] 图片请求走代理: ${envProxy}`);
    } catch (e) {
      console.warn(
        '[image-provider] IMAGE_PROXY 创建代理失败:',
        e instanceof Error ? e.message : e,
      );
      cachedProxyDispatcher = null;
    }
    return cachedProxyDispatcher ? { dispatcher: cachedProxyDispatcher } : {};
  }

  // 未配置代理 → 自动检测
  if (cachedProxyUrl === undefined) {
    // 标记已检测过，避免重复探测
    cachedProxyUrl = '__auto__';

    // 1) 尝试检测本地 SOCKS5 端口
    const detected = await detectLocalSocks5();
    if (detected) {
      try {
        cachedProxyDispatcher = createSocks5Dispatcher(detected);
        cachedProxyUrl = detected;
        return { dispatcher: cachedProxyDispatcher };
      } catch (e) {
        console.warn(
          '[image-provider] 自动检测到 SOCKS5 但创建代理失败:',
          e instanceof Error ? e.message : e,
        );
      }
    }

    // 2) 尝试读取 Windows 系统代理（Clash/V2Ray 的"系统代理"模式）
    const sysProxyPort = getWindowsSystemProxyPort();
    if (sysProxyPort) {
      // 先验证端口是否真的开放
      const portOpen = await new Promise<boolean>((resolve) => {
        const socket = new Socket();
        const timer = setTimeout(() => { socket.destroy(); resolve(false); }, 100);
        socket.connect(sysProxyPort, '127.0.0.1', () => { clearTimeout(timer); socket.destroy(); resolve(true); });
        socket.on('error', () => { clearTimeout(timer); resolve(false); });
      });
      if (!portOpen) {
        console.log(`[image-provider] 系统代理端口 ${sysProxyPort} 未开放，直连`);
      } else {
        // 先尝试 SOCKS5（Clash/V2Ray 通常暴露 SOCKS5 端口）
        const socksUrl = `socks5://127.0.0.1:${sysProxyPort}`;
        try {
          cachedProxyDispatcher = createSocks5Dispatcher(socksUrl);
          cachedProxyUrl = socksUrl;
          console.log(`[image-provider] 使用 Windows 系统代理 (SOCKS5): ${socksUrl}`);
          return { dispatcher: cachedProxyDispatcher };
        } catch {
          // SOCKS5 失败，回退 HTTP
        }
        // 回退 HTTP 代理
        const httpUrl = `http://127.0.0.1:${sysProxyPort}`;
        try {
          cachedProxyDispatcher = new ProxyAgent(httpUrl);
          cachedProxyUrl = httpUrl;
          console.log(`[image-provider] 使用 Windows 系统代理 (HTTP): ${httpUrl}`);
          return { dispatcher: cachedProxyDispatcher };
        } catch (e) {
          console.warn(
            '[image-provider] 系统代理创建失败:',
            e instanceof Error ? e.message : e,
          );
        }
      }
    }
  }

  return cachedProxyDispatcher ? { dispatcher: cachedProxyDispatcher } : {};
}

/**
 * Create an OpenAI-compatible text-to-image provider.
 * Uses IMAGE_API_KEY, IMAGE_BASE_URL, IMAGE_MODEL, IMAGE_TIMEOUT environment variables.
 *
 * Supports the `/v1/images/generations` protocol used by:
 *   - reve (reve/create-image)
 *   - OpenAI DALL-E 3 (dall-e-3)
 *   - SiliconFlow, aimlapi, etc.
 *
 * The provider sends `{model, prompt, aspect_ratio}` (reve/siliconflow style).
 * Response is expected as `{data: [{url?, b64_json?}]}`. We prefer b64_json
 * (no second hop); otherwise we fetch the url into a buffer.
 */
export function createImageProvider(config?: ImageCustomConfig): ImageProvider {
  console.log(`[image-provider] createImageProvider config:`, JSON.stringify({ size: config?.size, baseUrl: config?.baseUrl, model: config?.model }));
  const apiKey = config?.apiKey || process.env.IMAGE_API_KEY || '';
  const rawBaseUrl = config?.baseUrl || process.env.IMAGE_BASE_URL || 'https://api.openai.com/v1/images/generations';
  const baseUrl = normalizeApiUrl(rawBaseUrl, 'images/generations');
  const model = config?.model || process.env.IMAGE_MODEL || 'reve/create-image';
  const configSize = config?.size || process.env.IMAGE_SIZE || '';
  const envTimeout = parseInt(process.env.IMAGE_TIMEOUT || '', 10);
  const timeout = config?.timeout || (envTimeout > 0 ? envTimeout : DEFAULT_TIMEOUT);

  return {
    name: 'custom',

    isConfigured(): boolean {
      return !!apiKey;
    },

    async generateImage(prompt: string, opts?: { aspectRatio?: string; seed?: number }):
      Promise<{ buffer: Buffer; mime: string }> {
      if (!apiKey) {
        throw new ProviderNotConfiguredError('custom');
      }

      let response;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        try {
          const requestBody: Record<string, unknown> = { prompt };
          // OpenAI/SiliconFlow 等需要 model；Reve 这类专属端点不接受 model（报
          // UNRECOGNIZED_PARAMETER），设 IMAGE_NO_MODEL=1 跳过。
          if (process.env.IMAGE_NO_MODEL !== '1') requestBody.model = model;
          // 尺寸参数：configSize 优先（Seedream/OpenAI 风格，如 "2K"/"1024x1024"），
          // 否则用 aspect_ratio（Reve/SiliconFlow 风格，如 "16:9"）。
          if (configSize) {
            requestBody.size = configSize;
          } else if (opts?.aspectRatio) {
            requestBody.aspect_ratio = opts.aspectRatio;
          }
          // Seedream 等支持的额外参数
          if (process.env.IMAGE_WATERMARK === '1') requestBody.watermark = true;
          // Ask provider to inline base64 when supported — avoids a second fetch.
          // (OpenAI uses response_format=b64_json; reve/aimlapi accepts convert_base64_to_url=false.)
          if (process.env.IMAGE_B64_INLINE === '1') {
            requestBody.response_format = 'b64_json';
          }
          console.log(`[image-provider] 请求: POST ${baseUrl}`);
          console.log(`[image-provider] Body:`, JSON.stringify(requestBody).slice(0, 300));
          const proxyDispatcher = await getProxyDispatcher();
          const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          };
          const body = JSON.stringify(requestBody);
          // 有代理时用 undici.fetch（需要 dispatcher），无代理时用内置 fetch（兼容性更好）
          if (proxyDispatcher.dispatcher) {
            response = await undiciFetch(baseUrl, {
              method: 'POST',
              headers,
              signal: controller.signal,
              body,
              dispatcher: proxyDispatcher.dispatcher,
            });
          } else {
            response = await fetch(baseUrl, {
              method: 'POST',
              headers,
              signal: controller.signal,
              body,
            });
          }
        } finally {
          clearTimeout(timeoutId);
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          throw new LLMError(
            `Image generation timed out after ${timeout}ms`,
            'custom', 'IMAGE_TIMEOUT', true
          );
        }
        throw new LLMError(
          `Network error: cannot reach image provider. Check IMAGE_BASE_URL and firewall settings. (${error instanceof Error ? error.message : String(error)})`,
          'custom', 'IMAGE_NETWORK', true
        );
      }

      if (!response.ok) {
        const detail = await safeReadText(response);
        throw new LLMError(
          `Image provider returned HTTP ${response.status}: ${detail.slice(0, 500)}`,
          'custom', 'IMAGE_HTTP', true
        );
      }

      const json = await response.json() as {
        data?: Array<{ url?: string; b64_json?: string }>;
        image?: string; // Reve 专属格式：{ image: "<base64 PNG>" }
        b64?: string;
      };

      // Reve 格式：顶层 { image: "<base64>" }，直接内联 base64，无需二次下载。
      const directB64 = json.image || json.b64;
      if (directB64) {
        try {
          return { buffer: Buffer.from(directB64, 'base64'), mime: 'image/png' };
        } catch (error) {
          throw new LLMError(
            `Failed to decode base64 image: ${error instanceof Error ? error.message : String(error)}`,
            'custom', 'IMAGE_DECODE', true
          );
        }
      }

      // OpenAI 标准格式：{ data: [{ url?, b64_json? }] }
      const item = json.data?.[0];
      if (!item) {
        throw new LLMError(
          'Image provider returned no data array',
          'custom', 'IMAGE_EMPTY', true
        );
      }

      // Prefer inline base64 (no second network hop)
      if (item.b64_json) {
        try {
          return { buffer: Buffer.from(item.b64_json, 'base64'), mime: 'image/png' };
        } catch (error) {
          throw new LLMError(
            `Failed to decode base64 image: ${error instanceof Error ? error.message : String(error)}`,
            'custom', 'IMAGE_DECODE', true
          );
        }
      }

      // Otherwise fetch from the returned URL
      if (item.url) {
        try {
          const proxyDispatcher = await getProxyDispatcher();
          const dlSignal = AbortSignal.timeout(timeout);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let imgResp: any;
          if (proxyDispatcher.dispatcher) {
            imgResp = await undiciFetch(item.url, {
              signal: dlSignal,
              dispatcher: proxyDispatcher.dispatcher,
            });
          } else {
            imgResp = await fetch(item.url, { signal: dlSignal });
          }
          if (!imgResp.ok) {
            throw new LLMError(
              `Failed to download image from ${item.url}: HTTP ${imgResp.status}`,
              'custom', 'IMAGE_DOWNLOAD', true
            );
          }
          const mime = imgResp.headers.get('content-type') || 'image/png';
          const arrayBuffer = await imgResp.arrayBuffer();
          return { buffer: Buffer.from(arrayBuffer), mime };
        } catch (error) {
          if (error instanceof LLMError) throw error;
          throw new LLMError(
            `Failed to download image from ${item.url}: ${error instanceof Error ? error.message : String(error)}`,
            'custom', 'IMAGE_DOWNLOAD', true
          );
        }
      }

      throw new LLMError(
        'Image provider response had neither b64_json nor url',
        'custom', 'IMAGE_NO_OUTPUT', true
      );
    },
  };
}

async function safeReadText(response: { text(): Promise<string> }): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}
