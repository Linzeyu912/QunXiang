# Novel Agent

面向小说 IP 资产生产的实体提取与故事链路工作台。系统把 TXT 小说解析成可审核、可导出的角色、场景、道具、叙事事件和生图提示词，并提供前端页面查看管线过程与中间产物。

## 当前能力

- 上传 TXT 小说，自动识别书名、章节结构和文本噪声。
- 运行实体提取管线：角色提取、置信度校验、实体消解、简介融合、视觉描述、提示词生成、审核入库。
- 在 Web UI 审核角色、场景、道具，查看证据片段、结构化描述、视觉设定、生成提示词、共现角色和审核历史。
- 查看管线运行历史、预扫描中间产物、章节切分结果、噪声过滤明细和叙事事件标注。
- 导出审核后的实体数据与提示词包。
- 使用故事链路页面做故事切分、边界审核、资产包、导演分配和分镜/视频相关产物管理。

## 环境要求

- Windows 10/11、macOS 或 Linux。
- Node.js 20+。
- pnpm 9+，没有安装时可运行 `npm install -g pnpm`。
- 一个 LLM Provider：
  - 首次启动默认是未配置状态，需要先在 `LLM 设置` 填 API Key。
  - 模型调用使用 OpenAI-compatible Custom API。
  - 仅做冒烟测试时可运行 `start-mock.bat` 使用内置 mock 数据。

## Windows 快速启动

首次克隆后在仓库根目录运行：

```bat
setup.bat
launch.bat
```

`setup.bat` 会安装依赖、创建 `api/.env` 和 `storage/.env`、初始化 SQLite 数据库。默认不会写入可用 API Key；进入系统后先到 `LLM 设置` 配置 Provider，否则提取按钮会保持禁用。

`launch.bat` 会打开两个窗口：

- API: `http://localhost:3000`
- Web: `http://localhost:5173`

也可以直接运行：

```bat
start.bat
```

它会在缺少本地配置时补齐 env 和 SQLite 数据库，然后启动 API 与 Web。

## 手动启动

适合 macOS/Linux，或需要自己控制环境变量的 Windows 用户。

```bash
pnpm install
cp api/.env.example api/.env
```

编辑 `api/.env`，至少确认这些变量：

```env
PORT=3000
NODE_ENV=development
JWT_SECRET=replace-with-a-long-random-secret
DATABASE_URL=file:../storage/prisma/dev.db
ALLOWED_ORIGINS=http://localhost:5173
LLM_PROVIDER=custom
LLM_API_KEY=
LLM_BASE_URL=
LLM_MODEL=
```

初始化数据库：

```bash
pnpm db:push
```

分别启动后端和前端：

```bash
pnpm dev:api
pnpm dev:web
```

打开 `http://localhost:5173`。

## 配置 LLM

启动后进入 Web 顶部导航的 `LLM 设置`：

- `Mock`：内置假数据，不需要 API Key，仅用于部署冒烟测试；普通用户首次启动不会默认启用。
- `Custom API`：填写 API Key、模型名、Base URL。Base URL 可以是 `/v1` 根地址，也可以是完整 `/chat/completions` 地址。

也可以直接在 `api/.env` 配置：

```env
LLM_PROVIDER=custom
LLM_API_KEY=sk-...
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o
```

修改 `.env` 后重启 API。

## 使用流程

1. 首次访问会进入登录页；首次使用点「注册」创建账户（邮箱 + 密码，密码本地 scrypt 哈希存储）。登录后进入 `书库`。
2. 在 `书库` 上传一本 TXT 小说。
3. 打开书籍详情，先看 `章节` Tab：确认切章模式、章节字数、噪声过滤明细和叙事事件标注。
4. 先进入 `LLM 设置` 配好 Provider；未就绪时 `管道` Tab 和书库列表里的提取按钮会禁用。
5. 进入 `管道` Tab，点击开始提取；运行历史、预扫描中间产物和结果概览会保留在页面上。
6. 提取完成后进入 `角色`、`场景`、`道具` Tab 审核实体（支持 J/K/A/R 快捷键、批量通过）。
7. 在实体详情里查看结构化描述、视觉设定、提示词、证据、共现角色和审核历史。
8. 进入 `导出` Tab 选择实体类型（角色 / 场景 / 道具）与格式，下载 JSON / Markdown / CSV。
9. 需要故事级资产时，进入 `故事`、`导演` 等 Tab 继续做切分、资产和分镜流程。

> 数据按账户隔离：每个用户只能看到自己上传的书。旧的 anonymous 数据在启用鉴权后不再可见，需要重新上传。

## 重要目录

- `api/.env`：API 运行配置。
- `storage/.env`：Prisma/SQLite 辅助配置。
- `storage/prisma/dev.db`：默认本地 SQLite 数据库。
- `storage/uploads/`：上传的 TXT 原文。
- `api/output/`：实体提取与故事链路最终产物。
- `api/.intermediate/`：预扫描等中间产物。
- `.novel-agent-config.encrypted`：从 Web UI 保存的 LLM 配置密文。

## 部署建议

当前仓库最稳妥的部署方式是“API 源码运行 + 前端静态构建”：

```bash
pnpm install --frozen-lockfile
pnpm db:push
pnpm --filter @novel-agent/web build
pnpm --filter @novel-agent/api exec tsx src/index.ts
```

生产或内网部署时建议：

- 设置 `NODE_ENV=production`、强随机 `JWT_SECRET`、`HOST=0.0.0.0`、明确的 `ALLOWED_ORIGINS`。
- 使用绝对路径的 SQLite `DATABASE_URL`，并定期备份 `storage/prisma/dev.db`、`storage/uploads/`、`api/output/` 和 `api/.intermediate/`。
- 用 Nginx/Caddy 托管 `web/dist`，并反向代理 API。
- 不要在生产环境长期使用 `LLM_PROVIDER=mock`。

注意：`api/package.json` 里的 `start` 依赖 `dist/index.js`，但当前 workspace 包仍以源码入口为主。若要做严格的容器化/纯 `node dist` 发布，需要先补 workspace 全量构建或 API bundling。

## 验证命令

```bash
pnpm exec vitest run
pnpm --filter @novel-agent/api build
pnpm --filter @novel-agent/web build
```

根目录 `pnpm test` 会重置测试 SQLite 数据库，适合 CI 或本地全量测试前使用。

## 常见问题

API 能启动但不能提取：
进入 `LLM 设置` 查看 Provider 是否就绪。未配置时页面可以打开，但点击提取会被后端拦截。

上传后章节为空或明显不对：
先看 `章节` Tab 的切章模式。如果显示兜底切章，说明文本没有被识别到稳定章节标题。

前端刷新书籍详情 404：
开发模式由 `web/vite.config.ts` 处理 HTML 路由回退；如果部署到 Nginx/Caddy，需要配置 SPA fallback 到 `index.html`。

找不到产物：
确认 API 是从 `api` 包目录启动的，默认产物目录是 `api/output` 和 `api/.intermediate`。
