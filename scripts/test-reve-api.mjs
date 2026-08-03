/**
 * Reve API 连接测试脚本
 *
 * 用法:
 *   IMAGE_API_KEY=your_key node scripts/test-reve-api.mjs              # 自动检测代理
 *   IMAGE_API_KEY=your_key IMAGE_PROXY=socks5://127.0.0.1:7891 node scripts/test-reve-api.mjs  # 指定代理
 */

import { Socket } from 'net';

const API_KEY = process.env.IMAGE_API_KEY;
if (!API_KEY) {
  console.error('❌ 请设置 IMAGE_API_KEY 环境变量');
  console.error('   IMAGE_API_KEY=your_key node scripts/test-reve-api.mjs');
  process.exit(1);
}

const BASE_URL = 'https://api.reve.com/v1/image/create';
const MODEL = 'reve/create-image';

// ── 代理检测 ──

const COMMON_SOCKS5_PORTS = [
  { port: 7891, name: 'Clash (mixed)' },
  { port: 7892, name: 'Clash (SOCKS5)' },
  { port: 10808, name: 'V2Ray' },
  { port: 1080, name: 'Shadowsocks / 通用' },
  { port: 6153, name: 'Surge' },
  { port: 2080, name: 'ClashX' },
];

async function detectLocalSocks5() {
  for (const { port, name } of COMMON_SOCKS5_PORTS) {
    const reachable = await new Promise((resolve) => {
      const socket = new Socket();
      const timer = setTimeout(() => { socket.destroy(); resolve(false); }, 50);
      socket.connect(port, '127.0.0.1', () => { clearTimeout(timer); socket.destroy(); resolve(true); });
      socket.on('error', () => { clearTimeout(timer); resolve(false); });
    });
    if (reachable) return { port, name };
  }
  return null;
}

// ── 主测试 ──

async function test() {
  console.log(`\n🔍 测试 Reve API`);
  console.log(`   端点: POST ${BASE_URL}`);
  console.log(`   模型: ${MODEL}`);
  console.log(`   Key:  ${API_KEY.slice(0, 8)}...${API_KEY.slice(-4)}\n`);

  // 代理检测
  const envProxy = process.env.IMAGE_PROXY;
  if (envProxy) {
    console.log(`🌐 使用用户指定代理: ${envProxy}`);
  } else {
    console.log(`🔎 自动检测本地 SOCKS5 代理...`);
    const detected = await detectLocalSocks5();
    if (detected) {
      console.log(`✅ 检测到 SOCKS5 代理: socks5://127.0.0.1:${detected.port} (${detected.name})`);
    } else {
      console.log(`⚠️  未检测到本地 SOCKS5 代理，将直连（Reve 可能被地区限制）`);
    }
  }

  const body = {
    model: MODEL,
    prompt: 'a simple red circle on white background',
    aspect_ratio: '1:1',
  };

  console.log(`\n📤 请求体:`, JSON.stringify(body, null, 2));

  try {
    const res = await fetch(BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });

    console.log(`\n📥 响应状态: ${res.status} ${res.statusText}`);

    const text = await res.text();
    console.log(`📥 响应体 (前 500 字):\n${text.slice(0, 500)}`);

    if (res.ok) {
      try {
        const json = JSON.parse(text);
        if (json.image || json.b64) {
          const b64 = json.image || json.b64;
          console.log(`\n✅ 成功! Reve 格式, base64 长度: ${b64.length}`);
        }
        if (json.data?.[0]) {
          const item = json.data[0];
          if (item.url) console.log(`\n✅ 成功! OpenAI 格式, URL: ${item.url.slice(0, 80)}...`);
          if (item.b64_json) console.log(`\n✅ 成功! OpenAI 格式, base64 长度: ${item.b64_json.length}`);
        }
      } catch {
        console.log(`\n⚠️  响应不是 JSON`);
      }
    } else {
      console.log(`\n❌ 请求失败 (${res.status})`);
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      console.log(`\n❌ 请求超时 (30s)`);
    } else {
      console.log(`\n❌ 网络错误: ${err.message}`);
    }
  }
}

test();
