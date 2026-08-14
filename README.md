---
tags:
  - 产品仓库
  - 群像
created: 2026-06-20
updated: 2026-08-25
status: 产品仓库 · 实体组与故事组成果的软件化集成
---

# 群像 QunXiang

> **许可说明：** 本项目采用自定义的[源代码可见参考许可证](LICENSE)，允许学习、修改、衍生及其他非商业使用；任何商业使用均须事先取得版权所有者的书面许可。本项目并非开源软件。

[![CI](https://github.com/Linzeyu912/QunXiang/actions/workflows/ci.yml/badge.svg)](https://github.com/Linzeyu912/QunXiang/actions/workflows/ci.yml)
[![Vite](https://img.shields.io/badge/Vite-5.4-646cff?logo=vite)](https://vitejs.dev/)
[![React](https://img.shields.io/badge/React-18.3-61dafb?logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript)](https://www.typescriptlang.org/)
[![Tailwind](https://img.shields.io/badge/Tailwind-3.4-38bdf8?logo=tailwindcss)](https://tailwindcss.com/)
[![Fastify](https://img.shields.io/badge/Fastify-4-000000?logo=fastify)](https://fastify.dev/)
[![Prisma](https://img.shields.io/badge/Prisma-5-2d3748?logo=prisma)](https://www.prisma.io/)
[![pnpm](https://img.shields.io/badge/pnpm-workspace-f69220?logo=pnpm)](https://pnpm.io/)
[![Node](https://img.shields.io/badge/Node-20%2B-339933?logo=node.js)](https://nodejs.org/)

面向小说 IP 资产生产的中文软件。系统把 TXT 小说转换为可追溯、可审核、可分享和可下载的人物、地点、道具、技能、设定、叙事事件、视觉设定、生成提示词与图片资产，并逐步承接故事理解、筛选、生成和审核能力。

**群像不是实体组或故事组的日常研发仓库，而是二者成果的软件化合体。** 内部私有仓库 `YingHe-entity` 和 `YingHe-story` 分别保存实体组、故事组的完整研发过程与工程代码；经过验证、达到产品交付标准的能力再整合到本仓库。群像保留公开产品所需的中文交互、账号与书库、多人分享、多密钥并发、文本编码兼容和管线稳定性能力。

## 项目定位与仓库关系

```text
YingHe-entity（实体组研发） ──┐
                              ├──► QunXiang（群像软件）
YingHe-story（故事组研发） ───┘

YingHe-music + YingHe-storyboard-video ──► ShengYing（声影软件）
YingHe 总仓库 ──► 保存项目定位、协作信息、阶段进度和稳定成果索引
```

| 项目/小组 | 职责 |
| --- | --- |
| 实体组 | 从文本提取人物、地点、道具、技能、世界观与体系设定，并生产可复用数字资产；研发源为 `YingHe-entity`。 |
| 故事组 | 与实体组对接，重构价值判断、故事切分、生成与审核流程，输出有价值的完整故事文本和故事资产；研发源为 `YingHe-story`。 |
| 群像 | 把实体组和故事组通过验证的成果整合为面向用户的软件；本仓库是产品实现与发布源。 |
| 音频组 | 从视频一组取得剧本和分镜脚本，生产对白、角色音色、音效、环境音、配乐、混音及音频剧。 |
| 视频合成一组 | 将故事文本裁剪、改编为剧本，再以专业术语写成画面主题、场景、镜头语言和机位运动明确的分镜脚本；不以二组当前能否实现为创作约束。 |
| 视频合成二组 | 将一组的画面描述转换为模型可用提示词，调用实体与音频资产，完成镜头生成、过程记录、合成与成片。 |
| 声影 | 把音频组和视频合成组通过验证的工程成果整合为音视频制作软件；产品仓库为 `ShengYing`。 |

团队的完整定位、计划与归档规则以 [YingHe 总仓库](https://github.com/Linzeyu912/YingHe.git) 为准。

## 当前能力

- 账号注册、登录、刷新会话、退出、修改资料与密码；数据按账号隔离。
- 上传 TXT 小说，统一文本编码，识别书名、章节结构和噪声；新账号可自动获得 `seed-library/` 中的预置示例书籍。
- 执行角色、场景、道具、世界观与体系设定提取，并支持对全文世界观进行结构化梳理。
- 道具可按武器、技能功法、食物、丹药、法宝等大类筛选；多套服饰角色可为每套服饰生成完整四视图提示词。
- 在网页中查看管线进度、运行历史、章节、证据片段、审核历史、共现角色及各类中间产物。
- 为实体调用兼容 OpenAI 协议的文生图服务，也可上传、浏览、设为主图和删除图片。
- 导出 JSON、Markdown、CSV；为完整书籍成果创建版本快照并下载完整数据包。
- 通过邮箱和账号分享码分享书籍；接收方可复制为自己的独立副本。
- 将角色、场景、道具发布到公共素材库，浏览公共素材并拿取到自己的书库。
- 继续完成故事切分、边界审核、故事资产包、导演分配、分集与分镜相关产物。
- 本地文件系统对象存储开箱即用；生产环境可切换到 MinIO、R2、AWS S3、OSS 等 S3 兼容服务。

## 工程结构

```text
QunXiang/
├── api/                 # 后端接口、鉴权与业务编排
├── web/                 # 中文网页工作台
├── core/                # 领域核心与共享类型
├── entity-prescan/      # 书名、章节与噪声预扫描
├── entity-resolution/   # 实体消解与描述融合
├── extractors/          # 角色、场景、道具、世界观提取器
├── import/              # 原文导入与编码规范化
├── preprocess/          # 文本预处理
├── scheduler/           # 提取管线调度
├── story-arcs/          # 故事切分、资产与导演流程
├── prompts/             # 提示词模板
├── llm/                 # 文本模型和文生图适配器
├── schemas/             # 数据契约
├── validators/          # 质量校验
├── exporters/           # JSON、Markdown、CSV 导出
├── storage/             # PostgreSQL、Prisma 与对象存储
├── seed-library/        # 新账号可物化的预置示例书库
├── scripts/             # 数据库、测试、校验和维护脚本
└── docs/                # 设计、部署、研究与阶段文档
```

## 环境要求

- Node.js 20+。
- pnpm 9+；未安装时可运行 `npm install -g pnpm`。
- PostgreSQL 15；Windows 快速启动和完整测试推荐使用 Docker Desktop。
- 实体提取需要一个兼容 OpenAI Chat Completions 协议的模型服务；只浏览页面或使用模拟模式时不需要真实密钥。
- AI 生图是可选能力，需要另行配置兼容 `/v1/images/generations` 的服务。

## Windows 快速启动

推荐先启动 Docker Desktop，然后在仓库根目录双击或运行：

```bat
start.bat
```

脚本会检查 Node.js 与 pnpm、安装依赖、创建本地环境文件、启动 PostgreSQL、执行正式迁移并生成 Prisma Client，最后打开：

- 网页：`http://localhost:5173`
- API：`http://localhost:3001`

若只想用模拟模型验证页面和流程，运行：

```bat
start-mock.bat
```

`setup.bat` 是不依赖 Docker 的 Windows 备选方案：它使用仓库随依赖安装的嵌入式 PostgreSQL 完成初始化；数据库已启动后可用 `launch.bat` 打开 API 与网页。两套数据库启动方式不要同时占用本机 `5432` 端口。

脚本只会写入开发用本地密钥，不会写入真实模型 API Key。进入系统后请在“模型设置”中配置服务商；未配置时提取按钮会保持禁用。

## 手动启动

适合 macOS、Linux，或希望自己控制服务的 Windows 用户。先安装依赖并准备环境文件：

```bash
pnpm install
cp api/.env.example api/.env
```

创建 `storage/.env`，写入与 `api/.env` 相同的两个数据库连接：

```env
DATABASE_URL=postgresql://novel_agent:change_me_in_production@127.0.0.1:5432/novel_agent
DIRECT_DATABASE_URL=postgresql://novel_agent:change_me_in_production@127.0.0.1:5432/novel_agent
```

默认本地配置使用文件系统对象存储，`OBJECT_STORAGE_SIGN_SECRET`、`JWT_SECRET` 和 `KEY_VAULTS_SECRET` 都必须设置。生产环境请分别换成独立的强随机值；`KEY_VAULTS_SECRET` 丢失后，网页保存的模型密钥将无法解密。

使用仓库自带的 PostgreSQL 容器时：

```bash
docker compose up -d --wait postgres
pnpm db:migrate:deploy
pnpm --filter @novel-agent/storage exec prisma generate --schema=./prisma/schema.prisma
```

分别启动后端和前端：

```bash
pnpm dev:api
pnpm dev:web
```

打开 `http://localhost:5173`，注册账号后进入书库。若已有本机 PostgreSQL，请把两个 `.env` 中的连接地址改成同一个实际数据库，再执行迁移。

## 模型与文生图配置

启动后进入顶部导航的“模型设置”。

文本模型支持 DeepSeek、MiniMax、OpenAI、SiliconFlow、智谱、Moonshot、百度千帆、阿里通义、Anthropic 等预设，也可填写任意 OpenAI 兼容地址。可以保存多个 API Key，由调度器轮询使用。`Mock` 仅用于开发和冒烟验证。

文生图支持 Reve、OpenAI、SiliconFlow、智谱、阿里通义、火山引擎等预设，也可使用自定义兼容接口；尺寸、实体默认宽高比和代理可分别配置。

网页保存的文本与图片模型配置分别加密写入仓库根目录：

- `.novel-agent-config.encrypted`
- `.novel-agent-image-config.encrypted`

它们和本地 `.env` 已被 Git 忽略。不要提交真实密钥。

## 使用流程

1. 注册或登录；新账号会把 `seed-library/` 中的预置书籍复制到自己的账号下。
2. 在“书库”上传 TXT，或打开预置书籍查看已有实体和图片。
3. 在“模型设置”配置文本模型；需要 AI 生图时再配置文生图服务。
4. 在书籍的“章节”和“管道”页检查切章、噪声与预扫描结果，然后开始或继续提取。
5. 在“角色”“场景”“道具”页审核实体；道具可按武器、技能功法、食物、丹药、法宝等大类筛选和修改。
6. 在“世界观”页梳理世界观总览、修炼体系、规则与历史背景；角色含多套服饰时，提示词区会为每套服饰生成完整四视图。
7. 在“导出”页下载单类实体结果；在书库准备并下载包含完整成果的版本快照。
8. 使用书库的分享按钮把书籍发给指定账号，或把单个实体发布到“公共素材库”。
9. 需要故事级资产时，继续进入“故事”“导演”等页面完成后续流程。

## 数据与目录

- PostgreSQL 是账号、书籍、实体、审核、分享、快照和公共素材元数据的权威来源。
- `storage/objects/` 是默认本地对象存储，保存原文、图片、快照归档和对象化管线产物；切换到 S3 时由对应存储桶承载。
- `storage/uploads/` 保留兼容旧数据的本地上传与实体图片路径。
- `api/output/` 和 `api/.intermediate/` 是源码运行时的本地管线产物与预扫描中间结果；新的正式产物会同步到对象存储和 `BookArtifact` 记录，Git 不跟踪这些运行目录。
- `seed-library/` 是随代码版本管理的预置示例书包，不是某个运行账号的数据目录。
- `storage/prisma/migrations/` 是 PostgreSQL 正式迁移历史；`storage/prisma/sqlite-legacy/` 仅保留旧版 SQLite 迁移资料。

备份时至少保留 PostgreSQL、对象存储目录或存储桶、运行环境文件及两个加密模型配置文件。`KEY_VAULTS_SECRET` 必须与加密配置一起备份。

## Linux 生产部署

仓库提供 API、前端、PostgreSQL、Caddy 的容器配置。服务器安装 Docker 与 Docker Compose 插件后，在项目根目录运行：

```bash
bash deploy.sh
```

脚本会生成 PostgreSQL、JWT、下载签名和模型配置加密密钥，构建镜像、执行迁移并启动服务。首次部署后：

- 在 `api/.env.production` 中配置真实模型参数，或登录网页后配置。
- 备份 `api/.env.production`、`.db-password`、`.env.docker`、PostgreSQL 卷和对象存储卷。
- 不要把脚本生成后的密钥提交到 Git。
- 有域名时修改 `Caddyfile`，Caddy 可自动申请 HTTPS 证书。

API 容器通过 `tsx` 运行 TypeScript 源码，前端由 Nginx 托管静态构建并提供单页路由回退。`api/package.json` 的 `start` 仍指向 `dist/index.js`，当前部署流程不使用该命令。

## 验证

基础检查：

```bash
pnpm check:workspace-deps
pnpm --filter @novel-agent/api exec tsc -p tsconfig.json --noEmit --rootDir .. --pretty false
pnpm --filter @novel-agent/web build
```

完整测试会启动隔离的 PostgreSQL 与 MinIO 测试容器、重置测试库并在结束后清理，不会连接或重置正式数据库：

```bash
pnpm test
```

因此完整测试需要正在运行的 Docker。已知限制和待办见 [`KNOWN_ISSUES.md`](KNOWN_ISSUES.md)。

## 常见问题

API 提示缺少 `OBJECT_STORAGE_SIGN_SECRET`：在 `api/.env` 中配置一个本地随机密钥并重启 API；生产环境不要使用示例值。

API 能启动但不能提取：进入“模型设置”确认文本模型已经保存并显示可用。

上传后章节为空或明显不对：先查看“章节”页的切章模式和噪声过滤明细；兜底切章表示原文没有识别到稳定的章节标题。

数据库认证失败：确认 `api/.env`、`storage/.env` 和 PostgreSQL 实际密码一致。Windows Docker 启动脚本会调用 `pnpm db:sync-password` 修复已有数据卷的密码漂移。

前端部署后刷新页面返回 404：生产部署必须启用单页路由回退；仓库提供的 `web/nginx.conf` 已配置。

## 与分组仓库、统筹仓库的关系

本仓库是群像产品代码、公共示例书包和产品文档的权威来源，但不是实体组或故事组完整研发现场的替代品。实体能力应先在 `YingHe-entity` 形成稳定成果，故事能力应先在 `YingHe-story` 完成重构、验证与评审，再按明确版本整合到群像。

`YingHe` 总仓库保存项目定位、跨组规范、阶段进度与稳定成果索引，不接收本仓库源码。音频组、视频合成两组通过稳定实体 ID、故事资产 ID、证据片段、视觉设定和版本引用群像上游成果。运行缓存不能替代正式资产版本。

## 协作约定

- 开始工作前先同步远程分支，提交说明应明确变更类型与内容。
- 大附件使用 Git LFS；调研文档按项目文档规范归档。
- 面向用户的界面文案、提示、错误与日志统一使用中文；代码标识符使用英文，注释使用中文（见 `AGENTS.md`）。

---

*实体提取组维护 · 最近更新 2026-08-04*
