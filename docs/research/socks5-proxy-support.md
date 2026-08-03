# SOCKS5 代理支持方案研究报告

> 日期: 2026-07-14
> 背景: Reve API 在中国大陆被地区限制（`GEORESTRICTED`），Cloudflare WARP 虽然改变了出口 IP，但 Reve 仍封锁数据中心 IP 段。需要 SOCKS5 代理支持来绕过限制。

---

## 1. 现状分析

### 当前代理架构

```
image-custom.ts
  └─ undici.ProxyAgent (仅支持 HTTP/HTTPS 代理)
     └─ IMAGE_PROXY=http://127.0.0.1:7890
```

**限制**: `undici.ProxyAgent` 只支持 HTTP CONNECT 代理，不支持 SOCKS5。

### 依赖版本

| 包 | 版本 | 说明 |
|----|------|------|
| undici | 6.27.0 | HTTP 客户端，内置 ProxyAgent |
| Node.js | 20+ | 内置 fetch 基于 undici |

---

## 2. 方案对比

### 方案 A: `socks` 包 + undici 自定义 Connector ⭐ 推荐

**原理**: 用 `socks` 包建立 SOCKS5 隧道，获取原始 TCP Socket，传给 undici 的 `buildConnector`。

```
undici.fetch()
  └─ Agent({ connect: socksConnector })
     └─ socks.SocksClient.createConnection()  // 建立 SOCKS5 隧道
        └─ 返回 net.Socket
           └─ undici 在此 Socket 上跑 TLS/HTTP
```

**优点**:
- 零破坏性：不替换 undici，不改变现有 HTTP 代理逻辑
- 纯增量：新增 `socks` 依赖（28KB），无其他依赖
- 与现有 `IMAGE_PROXY` 环境变量兼容，自动识别 `socks5://` 前缀
- 类型安全：`socks` 包自带 TypeScript 类型

**缺点**:
- 需要手写 connector 适配层（约 40 行代码）

**依赖**:
```json
{ "socks": "^2.8.9" }
```

---

### 方案 B: 升级 undici 到 7.x + `fetch-socks`

**原理**: `fetch-socks` 包为 undici 7+ 提供 SOCKS5 支持。

**优点**:
- 代码最简洁，几行搞定

**缺点**:
- ⚠️ **破坏性升级**: undici 6 → 7 是 major 版本，API 可能有 breaking changes
- `fetch-socks` 要求 `undici >=7`，与当前 6.27.0 不兼容
- 需要全面回归测试所有使用 undici 的地方（LLM provider + image provider）

**结论**: 风险过高，不推荐。

---

### 方案 C: 本地 HTTP→SOCKS5 转换器

**原理**: 在项目内启动一个小型 HTTP 代理服务，内部转发到 SOCKS5。

```
image-custom.ts
  └─ undici.ProxyAgent → http://127.0.0.1:本地端口
     └─ 转换器进程 (privoxy/gost/自写)
        └─ SOCKS5 代理服务器
```

**优点**:
- 完全不动 undici 代码

**缺点**:
- 需要额外运行一个进程
- 部署复杂度增加
- 故障排查困难（两层代理）

**结论**: 作为兜底方案，不首选。

---

### 方案 D: `socks-proxy-agent` + Node.js http 模块

**原理**: 用 `socks-proxy-agent` 创建 `http.Agent`，用 Node.js 原生 `http.request` 代替 `undici.fetch`。

**优点**:
- `socks-proxy-agent` 成熟稳定

**缺点**:
- ⚠️ 需要替换所有 `undici.fetch` 调用为 `http.request` 或 `node-fetch`
- 与现有代码架构不兼容（注释明确说"必须用 undici 自己的 fetch"）

**结论**: 不适用。

---

## 3. 推荐方案详细设计（方案 A）

### 3.1 新增依赖

```json
// llm/package.json
{
  "dependencies": {
    "socks": "^2.8.9"  // +新增
  }
}
```

### 3.2 环境变量扩展

```bash
# 现有（HTTP 代理，保持兼容）
IMAGE_PROXY=http://127.0.0.1:7890

# 新增（SOCKS5 代理）
IMAGE_PROXY=socks5://127.0.0.1:1080
IMAGE_PROXY=socks5://user:pass@127.0.0.1:1080  # 带认证
```

通过 URL scheme 自动识别代理类型：
- `http://` / `https://` → 走现有 `undici.ProxyAgent`
- `socks5://` / `socks5h://` → 走新的 SOCKS5 connector

### 3.3 代码改动

**文件**: `llm/src/providers/image-custom.ts`

改动范围：仅 `getProxyDispatcher()` 函数，约 40 行新增代码。

```typescript
import { SocksClient } from 'socks';
import { buildConnector, Agent, fetch as undiciFetch, ProxyAgent } from 'undici';

// 判断是否为 SOCKS5 代理
function isSocksProxy(url: string): boolean {
  return /^socks5h?:\/\//i.test(url);
}

// 创建 SOCKS5 的 undici connector
function createSocksConnector(proxyUrl: string) {
  const parsed = new URL(proxyUrl);
  const proxyHost = parsed.hostname;
  const proxyPort = parseInt(parsed.port, 10) || 1080;
  const proxyType = parsed.protocol === 'socks5h:' ? 5 : 5; // socks5h = 远程 DNS
  const username = parsed.username || undefined;
  const password = parsed.password || undefined;

  const defaultConnector = buildConnector({});

  return buildConnector({}) ;
  // 实际实现见下方
}
```

核心逻辑：

```typescript
async function getProxyDispatcher(): Promise<{ dispatcher?: Dispatcher }> {
  const proxyUrl = process.env.IMAGE_PROXY;
  if (!proxyUrl) return {};

  if (isSocksProxy(proxyUrl)) {
    // SOCKS5 模式
    return { dispatcher: createSocksAgent(proxyUrl) };
  } else {
    // HTTP 代理模式（现有逻辑）
    return { dispatcher: new ProxyAgent(proxyUrl) };
  }
}
```

### 3.4 测试计划

| 测试项 | 方法 |
|--------|------|
| SOCKS5 连通性 | `IMAGE_PROXY=socks5://127.0.0.1:1080 node scripts/test-reve-api.mjs` |
| HTTP 代理兼容 | `IMAGE_PROXY=http://127.0.0.1:7890 node scripts/test-reve-api.mjs` |
| 无代理回退 | 不设 IMAGE_PROXY，确认正常请求 |
| 带认证 SOCKS5 | `socks5://user:pass@host:port` |
| 单元测试 | mock SocksClient，验证 connector 调用参数 |

---

## 4. 用户使用指南

### 4.1 获取 SOCKS5 代理

**选项 1: Clash/V2Ray 本地端口**
```bash
# Clash 默认 SOCKS5 端口
IMAGE_PROXY=socks5://127.0.0.1:7891

# V2Ray 默认 SOCKS5 端口
IMAGE_PROXY=socks5://127.0.0.1:10808
```

**选项 2: 海外 VPS 自建**
```bash
# 在 VPS 上运行 sshd，本地 SSH 隧道
ssh -D 1080 user@your-vps

# 然后
IMAGE_PROXY=socks5://127.0.0.1:1080
```

**选项 3: 商业 SOCKS5 代理**
```bash
IMAGE_PROXY=socks5://user:pass@proxy-provider.com:1080
```

### 4.2 配置方式

**方式 1: 环境变量**
```bash
IMAGE_PROXY=socks5://127.0.0.1:1080 pnpm dev
```

**方式 2: .env 文件**
```env
IMAGE_PROXY=socks5://127.0.0.1:1080
```

**方式 3: 前端设置页面**（可选扩展）
在 LLM 设置页的文生图卡片中增加"代理地址"输入框。

---

## 5. 工作量评估

| 项目 | 工时 |
|------|------|
| 新增 `socks` 依赖 | 5 分钟 |
| 改造 `getProxyDispatcher()` | 1-2 小时 |
| 单元测试 | 1 小时 |
| 更新 .env.example + 文档 | 30 分钟 |
| 端到端验证（需有 SOCKS5 代理） | 30 分钟 |
| **总计** | **约 3-4 小时** |

---

## 6. 风险评估

| 风险 | 等级 | 缓解措施 |
|------|------|----------|
| `socks` 包兼容性 | 低 | 纯网络层，不涉及 undici 内部 API |
| 现有 HTTP 代理回退 | 低 | 通过 URL scheme 分支，HTTP 代理走原逻辑 |
| SOCKS5 服务器不可用 | 中 | 超时处理 + 明确错误提示 |
| undici 未来版本变更 | 低 | `buildConnector` 是稳定 API |

---

## 7. 结论

**推荐方案 A**（`socks` 包 + undici 自定义 Connector）：
- 零破坏性，纯增量改动
- 自动识别 `socks5://` 和 `http://` 代理
- 用户只需设一个环境变量即可切换代理类型
- 工作量小（3-4 小时），风险低

下一步：确认后开始实施。
