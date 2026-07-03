# 群像 QunXiang

[![Vite](https://img.shields.io/badge/Vite-5.4-646cff?logo=vite)](https://vitejs.dev/)
[![React](https://img.shields.io/badge/React-18.3-61dafb?logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript)](https://www.typescriptlang.org/)
[![Tailwind](https://img.shields.io/badge/Tailwind-3.4-38bdf8?logo=tailwindcss)](https://tailwindcss.com/)
[![Fastify](https://img.shields.io/badge/Fastify-4-000000?logo=fastify)](https://fastify.dev/)
[![Prisma](https://img.shields.io/badge/Prisma-5-2d3748?logo=prisma)](https://www.prisma.io/)
[![pnpm](https://img.shields.io/badge/pnpm-workspace-f69220?logo=pnpm)](https://pnpm.io/)
[![Node](https://img.shields.io/badge/Node-20%2B-339933?logo=node.js)](https://nodejs.org/)

**从小说文本中提取角色、场景、道具与叙事事件，扩写为生成式提示词，产出可复用的数字资产。**

*Turn novel text into structured entities — characters, scenes, props, and narrative events — then expand them into generation-ready prompts for digital IP assets.*

---

## 这是什么

「群像」是一个开源的**小说/剧本实体抽取与数字资产生成引擎**。

短剧、动画、游戏、AI 内容创作的上游都是文本，但一段小说原文没法直接喂给图像/视频生成模型——角色长什么样、场景是什么氛围、道具有什么细节，都散落在成百上千段描述里，且分散在几十章节中反复出现、彼此矛盾或互相补充。

群像做的事情，是把这堆散落的文字，整理成一份可以被创作者、生成模型、资产库直接使用的结构化资料：

```
小说 / 剧本 / 设定集文本
        │
        ▼
   导入 + 预处理（编码检测、章节切分、噪声清理）
        │
        ▼
   实体预扫描 + 抽取（角色 / 场景 / 道具 / 叙事事件）
        │
        ▼
   校验 + 实体消解（跨章节合并、置信度校验、简介融合）
        │
        ▼
   视觉描述 + 提示词生成（图像 / 视频 / 3D 模型等下游用途）
        │
        ▼
   人工审核入库 + 多格式导出（结构化数字资产）
```

产出的资产最终服务于短剧制作流程（选角、置景、道具设计、分镜）和数字 IP 社区（创作者围绕同一部作品的角色/场景库进行二创、扩展、共建）。

## 核心能力

- **多类型实体抽取**——角色（姓名、别名、外貌、性格）、场景（地点、氛围、时间）、道具（外观、归属、作用）、叙事事件
- **跨章节实体消歧与合并**——同一角色在不同章节的描述自动关联、去重、补全，而不是抽取出一堆碎片
- **原文索引**——每条描述都保留对原文位置（章节/段落/引用片段）的追溯，方便核对与人工修订
- **描述扩写**——将小说中零散、克制的原文描述，扩写为细节完整、适合下游生成模型理解的结构化描述
- **提示词生成**——针对图像/视频生成场景，将扩写后的描述转换为可直接使用的生成式提示词
- **可插拔 LLM 后端**——OpenAI 兼容的 Custom API、内置 Mock 模式可切换，按成本和精度取舍
- **人工审核环节**——自动抽取结果保留人工确认/修正的空间（支持快捷键、批量通过、审核历史），而不是全自动黑箱产出
- **多格式导出**——JSON / Markdown / CSV，方便接入下游生产工具链或社区平台
- **故事链路**——在实体资产之上做故事切分、边界审核、资产包、导演分配和分镜/剧集管理

## 技术栈

前端、后端、管线各自独立，通过 pnpm workspace 组织成 17 个本地包。

| 层 | 技术 |
| --- | --- |
| Web 前端 | React 18 + Vite 5 + TypeScript（strict）+ Tailwind 3 + Radix UI + TanStack Query + Zustand + React Router |
| API 后端 | Fastify 4 + Prisma 5 + SQLite + `@fastify/jwt` 鉴权 + `@fastify/multipart` 上传 |
| 抽取管线 | TypeScript workspace 包：`import` → `preprocess` → `entity-prescan` → `extractors` → `validators` → `entity-resolution` → `exporters`，由 `scheduler` 调度 |
| LLM | OpenAI 兼容 Custom Provider + Mock 模式（`llm` 包） |
| 测试 | Vitest |
| 包管理 | pnpm workspace + Node 20+ |

## 项目结构

```
QunXiang/
├─ core/                # 领域模型与共享类型
├─ schemas/             # Zod 实体 schema（角色/场景/道具/事件）
├─ import/              # TXT 导入与书名/编码识别
├─ preprocess/          # 章节切分、噪声过滤
├─ entity-prescan/      # 实体预扫描与中间产物
├─ extractors/          # LLM 实体抽取
├─ validators/          # 置信度校验
├─ entity-resolution/   # 跨章节消解与合并
├─ prompts/             # 提示词模板
├─ llm/                 # 可插拔 LLM Provider
├─ scheduler/           # 内存任务队列 + 流水线编排
├─ exporters/           # JSON / Markdown / CSV 导出
├─ storage/             # Prisma schema + SQLite + 仓储层
├─ story-arcs/          # 故事链路：切分、资产、导演、分镜
├─ api/                 # Fastify HTTP 服务（port 3000）
├─ web/                 # Vite + React 前端（port 5173）
└─ docs/                # 流程图与研究文档
```

## 环境要求

- Windows 10/11、macOS 或 Linux
- Node.js 20+
- pnpm 9+（未安装可运行 `npm install -g pnpm`）
- 一个 LLM Provider：首次启动默认未配置，需先在 `LLM 设置` 填 API Key；仅冒烟测试时可运行 `start-mock.bat` 使用内置 Mock 数据

## 快速启动（Windows）

首次克隆后在仓库根目录运行：

```bat
setup.bat
launch.bat
```

- `setup.bat`：安装依赖、创建 `api/.env` 与 `storage/.env`、初始化 SQLite 数据库（默认不写入 API Key）
- `launch.bat`：同时启动 API（`http://localhost:3000`）与 Web（`http://localhost:5173`）

也可以直接运行 `start.bat`，它会在缺少本地配置时补齐 env 和 SQLite，然后启动服务；只跑假数据用 `start-mock.bat`。

## 手动启动（macOS / Linux）

```bash
pnpm install
cp api/.env.example api/.env
pnpm db:push
pnpm dev:api   # 后端
pnpm dev:web   # 前端
```

打开 `http://localhost:5173`。

## 配置 LLM

启动后进入 Web 顶部导航的 `LLM 设置`：

- `Mock`：内置假数据，不需要 API Key，仅用于部署冒烟测试
- `Custom API`：填写 API Key、模型名、Base URL（可以是 `/v1` 根地址，也可以是完整 `/chat/completions` 地址）

也可以直接在 `api/.env` 配置，修改后重启 API：

```env
LLM_PROVIDER=custom
LLM_API_KEY=sk-...
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o
```

## 使用流程

1. 首次访问进入登录页，点「注册」创建账户（邮箱 + 密码，密码本地 scrypt 哈希存储），登录后进入 `书库`。
2. 在 `书库` 上传一本 TXT 小说。
3. 打开书籍详情，先看 `章节` Tab：确认切章模式、章节字数、噪声过滤明细和叙事事件标注。
4. 先到 `LLM 设置` 配好 Provider；未就绪时 `管道` Tab 和书库列表里的提取按钮会禁用。
5. 进入 `管道` Tab，点击开始提取；运行历史、预扫描中间产物和结果概览会保留在页面上。
6. 提取完成后进入 `角色` / `场景` / `道具` Tab 审核实体（支持 J/K/A/R 快捷键、批量通过）。
7. 在实体详情里查看结构化描述、视觉设定、提示词、证据、共现角色和审核历史。
8. 进入 `导出` Tab 选择实体类型与格式，下载 JSON / Markdown / CSV。
9. 需要故事级资产时，进入 `故事` / `导演` / `剧集` 等 Tab 继续做切分、资产和分镜流程。

> 数据按账户隔离：每个用户只能看到自己上传的书。启用鉴权前的 anonymous 数据在启用鉴权后不再可见，需要重新上传。

## 重要目录

- `api/.env`：API 运行配置
- `storage/.env`：Prisma/SQLite 辅助配置
- `storage/prisma/dev.db`：默认本地 SQLite 数据库
- `storage/uploads/`：上传的 TXT 原文
- `api/output/`：实体提取与故事链路最终产物
- `api/.intermediate/`：预扫描等中间产物
- `.novel-agent-config.encrypted`：从 Web UI 保存的 LLM 配置密文

## 应用场景

- **短剧制作**：开机前快速产出角色小传、场景设定集、道具清单，供选角、美术、置景团队直接使用
- **数字 IP 社区**：围绕一部小说/剧本生成可共享的角色卡、场景卡，创作者可以在统一资产库基础上进行二创、拓展支线、共建世界观
- **AI 内容生产流水线**：作为文本到视觉生成的中间层，产出结构化提示词供图像/视频生成模型使用

## 项目状态

早期开发阶段，正在从内部迭代版本梳理出面向社区的独立开源实现。欢迎关注、提 Issue、参与设计讨论。

## 贡献

欢迎以 Issue、Discussion 或 PR 的形式参与。在正式的贡献指南发布前，建议先开 Issue 讨论设计再动手实现，避免重复劳动。

## 许可证与声明

本项目仅提供文本解析与资产生成工具，不提供、不分发任何受版权保护的小说原文。请确保你处理的文本已获得合法授权。

License：待定（建议 MIT，随首个可运行版本一并确定）。
