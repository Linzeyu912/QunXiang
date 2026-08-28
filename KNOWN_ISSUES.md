# Known Issues — YingHe-entity

> 本文档记录当前仓库已知的未解决问题,与测试状态对应。
> 每次修一个 issue,把它从本文件移到 git commit message。

最后更新:2026-08-28

---

## 测试状态（2026-08-28 模型B 后端等价优化后复核）

```
单元+服务层套件: 566 个测试, 563 通过
含集成测试全量:  709 个测试, 657 通过（20 个 fs 存储模式下跳过）
失败均为预存问题, 与本轮后端改动无关（已用 git stash 基线对照 + 隔离复跑双重验证）
```

运行方式:`node scripts/test.mjs`(自动起 docker postgres-test + minio-test,跑前 `prisma migrate reset`,跑完清理容器)。
无 Docker 环境的替代验证: `node scripts/pg-server.mjs start`(55432 隔离库) + `prisma migrate reset` + 直接 `pnpm exec vitest run`(OBJECT_STORAGE_PROVIDER=fs)。

### 已修复(2026-07-27 会话)

| # | 问题 | 根因 | 修法 |
|---|---|---|---|
| 1 | auth/session 集成测试 13 个失败:`prisma.user.deleteMany` 被 `Book_userId_fkey` 外键挡住 | 公共书库注册钩子(`provisionSeedLibrary`)给每个测试注册用户物化了真实 seed-library(468+ 实体),产生 Book 行,测试清理删 user 时违反外键 | `scripts/test-runner.mjs` 默认把 `SEED_LIBRARY_DIR` 指向空临时目录,关闭测试期间的物化;`register-seed.integration.test.ts` afterAll 改为还原(而非删除)之前的 `SEED_LIBRARY_DIR` |
| 2 | shares/snapshots 集成测试残留 AssetObject 唯一约束冲突 | 测试 PG 里的历史残留数据 | test-runner 每次跑前 `prisma migrate reset --force`,残留不再影响;本轮全量验证通过 |

### 已修复(归档:此前会话修复,本轮复核确认通过)

| # | 原 issue | 复核结果(2026-07-27) |
|---|---|---|
| 1 | ISSUE-1 `visual-description.agent` LLM 改写已有字段(4 测试) | `visual-description.agent.test.ts` 11 个 + `visual-description.quhun.test.ts` 2 个全部通过。当前 `safeLlmFields` 已实现"source 短而干净则不被 LLM 覆盖"(`isPureVisualSource`/`shouldSummarizeSourceField` 判断),与修复方向一致 |
| 2 | ISSUE-2 `description-fusion` 别名归一化(2 测试) | `description-fusion.agent.test.ts` 7 个全部通过,`萧薰儿/萧熏儿` 一字之差已能合并 |

---

## 当前未修复的测试（预存,与 2026-08-28 后端等价优化无关）

> 以下失败在优化前的干净基线（git stash 对照 + 隔离复跑）上同样出现;
> CI 中 vitest 为 `continue-on-error: true`,因此长期未被发现。

| # | 失败测试 | 根因 | 修复方向 |
|---|---|---|---|
| T1 | `postgresql-entrypoints.test.ts` ×3（setup/start/start-mock.bat） | 断言 .bat 中的旧版 SQLite 提示文案,脚本文案已改 | 同步测试断言或恢复脚本文案,二选一 |
| T2 | `postgresql-baseline.integration.test.ts` 「包含全部 Prisma 模型」 | 硬编码 19 个模型清单,DB 已 25 个模型（后续阶段新增） | 更新模型清单断言 |
| T3 | `postgresql-baseline.integration.test.ts` 「拥有书籍的账号不能被直接删除」 | Prisma 5.22 把外键 RESTRICT 报为 PrismaClientUnknownRequestError（无 code）,测试期望 P2003 | 断言改为匹配错误消息/或捕获 unknown 类型 |
| T4 | `ownership.integration.test.ts` ×3（stories/director 410、找回噪声行 needsReconfirm） | stories/director 路由 410 退场 preHandler 先于归属校验;噪声找回响应新增 needsReconfirm 字段,测试断言未同步 | 需先确认「410 先于 404」是否为预期契约（产品语义决策）,再同步断言 |
| T5 | 全量混跑时 asset-object / asset-snapshot / book-share / book / snapshot-object / task / shares / snapshots 等仓储与集成测试互相污染 | singleFork 单进程单库下,前序文件的 `PublicAssetImage`/`AssetObject`/`Task` 残留行阻塞后序文件清理或触发 objectKey 唯一冲突;单独运行均通过 | 各集成测试 beforeEach 补全关联表清理;或官方 test-runner 按文件分组重置 |

---

## 后端等价优化遗留待办（2026-08-28 模型B,按优先级推动）

> 背景:本轮等价优化已完成可靠性/安全/性能修复（见提交记录）。
> 以下问题在「接口契约冻结、不改用户链路」约束下**无法安全修复**,
> 需要产品决策或单独立项后实施。每完成一项,把它移到 git commit message。

### 🔴 P0 — 数据一致性 / 权限（建议尽快立项）

- [ ] **ISSUE-B1 产物人工编辑被对象存储旧副本遮蔽**
  `artifacts.service.ts` 的 `updateArtifact` 只写本机 `output/{runDir}/entities/*.json`,
  而 `getExtractionArtifacts` 读取时优先对象存储（BookArtifact）——
  一旦 scheduler 已双写产物到对象存储,用户 PATCH 的编辑会「静默丢失」。
  修复方向:编辑路径接入 `persistBookArtifact` 双写 + revision 递增。涉及数据写入语义,需立项。
- [ ] **ISSUE-B2 全局模型配置无角色隔离**
  `PATCH /health/llm/config`、`/health/image/config` 等只需任意登录 JWT,
  多用户部署时任一账号可改写全局 API Key/Base URL/并发模式。
  修复方向:引入 admin 角色或按账号隔离配置（改动鉴权模型,需立项）。
- [ ] **ISSUE-B3 对象存储孤儿对象无回收**
  `AssetObjectRepository.deleteIfUnreferenced`/`countReferences` 在生产代码零调用（死代码）;
  收集失败残留对象、生图 DB 写失败对象、`deleteEntityImageById` 不删对象存储。
  修复方向:落地引用计数 GC 后台任务（涉及删除语义,需谨慎设计）。

### 🟡 P1 — 可靠性补强

- [ ] **ISSUE-B4 边界取消后书籍状态停留 EXTRACTING**
  `checkRunControl` 取消分支只收敛会话不更新 Book.status（与 PAUSED 取消路径置 UPLOADED 不一致）。
  改状态属可观测行为变化,需产品确认取消后书籍应显示的状态后修复。
- [ ] **ISSUE-B5 KEY_VAULTS_SECRET 硬编码兜底**
  `configStore.ts` 在 .env 不可写时用公开常量加密落盘,磁盘上密钥文件等于公开可解。
  修复方向:生产环境（NODE_ENV=production）改为拒绝启动;开发环境保留警告。
- [ ] **ISSUE-B6 SSE 心跳不回查数据库**
  数据库与内存事件不同步时（如进程异常）SSE 只发心跳不收敛,依赖前端轮询兜底。
  修复方向:心跳周期内加一次终态 DB 复查。
- [ ] **ISSUE-B7 提取 Task 无租约/死信无出口**
  agent 执行期间任务无心跳;`dead_lettered` 任务无自动重试或告警,靠用户重新触发清理。
- [ ] **ISSUE-B8 用户缓存 15 秒失效窗口**
  `invalidateUserCache` 是死代码;停用/改密后旧 JWT 最长 15 秒内仍通过校验（有界,可接受）。
  修复方向:改密/停用路径接入缓存失效。

### 🟢 P2 — 性能 / 运维（证据已记录,实施需测量）

- [ ] **ISSUE-B9 download-state 轮询端点全目录扫描 + 全实体序列化**
  `getDownloadState` 每次轮询执行 `discoverCurrentRun`（readdir 整个 output/ + 逐目录读 run-summary）
  和三张实体表全量 `findByBookId` 仅为算 contentRevision。修复方向:run→book 索引表或短 TTL 缓存（注意失效正确性）。
- [ ] **ISSUE-B10 collector 每章全量重解析原文**
  `getChapterCleanedContent` 每章都对全书 normalize/detectNoise/splitChapters,O(章节数×全书)。
  修复方向:单次收集内按原文内容缓存规范化结果。
- [ ] **ISSUE-B11 签名 URL 即 HEAD**
  fs/s3 的 `createDownloadUrl` 先 head 再签名,公共素材列表页每图一次 HEAD（s3 下 20 次/页网络请求）。
- [ ] **ISSUE-B12 PublicAsset 标签/搜索无 GIN/trigram 索引**
  `tags array_contains` 与 `q contains` 全扫 published 集;`aggregateTags` 每请求展开全部素材。
- [ ] **ISSUE-B13 404 文案不统一**
  `artifacts.ts` 用「书籍不存在」而非统一的「书籍不存在或无权访问」;改文案属响应体变化,需与前端确认后统一。

---

## 前端 UI 优化遗留待办（2026-08-28 模型1，web/ 范围）

> 背景:本轮前端优化完成设计令牌统一（靛蓝主色 + success/warning/info 语义色）、
> 状态体验、无障碍与 LlmSettingsPage 拆分（见 `docs/模型1-前端优化交付报告.md`）。
> 以下问题在「不改业务链路、不改接口契约」约束下未安全解决,或需要真实运行环境验证。

### 🟡 P1 — 需要运行环境验证

- [ ] **ISSUE-F1 截图级视觉回归未覆盖**
  品牌主色由黑白改为靛蓝后,缺少四档视口（360×800 / 768×1024 / 1280×800 / 1440×900）
  明暗双主题的截图回归;富产物 Sparkles 图标与 Tier 四档色板仍用琥珀/天蓝作非状态装饰色,为有意保留。
  修复方向:dev 环境起后端后按视口人工过一遍登录、书库、管道、审核、设置页并留档截图。

### 🟢 P2 — 下轮可安全修复

- [ ] **ISSUE-F2 图片设置区表单回填可能覆盖编辑中内容**
  `components/settings/ImageModelSection.tsx` 初始化 effect 未加哨兵,`status` 引用每次变化
  （如保存后 refetch）都会重填全部字段,可能覆盖用户正在编辑的内容;文本模型区已有
  `initialized` ref 防护。本轮为保持「不改变保存时机」原样保留。
  修复方向:给图片区加同样的 `initialized` 哨兵（纯前端行为微调,无契约变化）。
- [ ] **ISSUE-F3 设置页缺运行时组件级测试**
  LlmSettingsPage 拆分（777 行 → 组合根 + settings/ 7 文件）目前只有源码级断言与
  tsc/build 保障。修复方向:用 React Testing Library 补保存流程特征测试
  （预设/自定义分支、密钥留空保留、warning toast）。
- [ ] **ISSUE-F4 前端 lint 存量 warning**
  `pnpm --filter @qunxiang/web lint` 有 10 个 warning（react-refresh 仅导出组件、
  exhaustive-deps 逻辑表达式依赖）,多为既有代码模式;不阻塞构建,可逐步清理。

---

## 与本仓库并列的 QunXiang

QunXiang 是以后要迁过去的主仓；本仓库当前功能领先，本阶段不跟 QunXiang 双向同步。

**已落地（2026-08-14）**：`VisualSpec` 版本化视觉规格。提取入库后把 prompt / 年龄 / 服饰套系写成 ACTIVE spec；生图优先读 spec，旧书回退 `*-prompts.json`。

**未做（有意推迟）**：Event 一等实体（等故事链路开工）、全类型审核历史、CI 摘 `continue-on-error`。

---

## 后续行动

1. **立即可做(零风险)**:
   - 把本次会话所有修改的文件提交 git
   - ~~在 CI 第一次跑通后,把 CI 状态 badge 加到 README~~(已完成 2026-07-27,CI main 最近运行 success)

2. **下一会话可做(中风险)**:
   - 把 QunXiang 的成熟文档(ENTITY_PRESCAN_FLOW、PROJECT_STATUS、所有研究报告)同步到 YingHe

3. **长期(高风险/高价值)**:
   - 把 YingHe 的生图能力反向移植到 QunXiang

---

## 产品待优化清单(从 `待优化.md` 迁入)

> 来源:微信文件 `D:\wechat\xwechat_files\wxid_d9ujuq8yrlgz22_8ff1\msg\file\2026-07\待优化.md`
> 迁入日期:2026-07-09
> 这些是**产品/功能层面**的待优化项,与上面的"测试失败"是两个维度——上面是**已存在但行为不对**,这里是**功能缺失或体验问题**。
> 为避免编号冲突,本节 issue 编号从 **ISSUE-3** 起(测试相关占用 ISSUE-1/2)。

按优先级从高到低:

### 🔴 P0 — 必须解决(核心闭环)

#### ISSUE-3: 图片资产上传功能缺失

**现象**:用户无法上传自己的图片到系统,只能使用 LLM 生成。

**根因**:`api/src/routes/images.ts` 只实现了 `POST/GET/DELETE` 的**生图**接口,**没有 multipart upload**。前端 `web/` 下也没有 upload 组件。

**影响**:阻塞 ISSUE-4 / ISSUE-6,整个图片资产管理无法起步。

**修复方向**:
- 新增 `POST /api/images/upload` 接口(multipart/form-data)
- 前端 `web/src/components/ImageUpload.tsx`
- 文件校验:大小、类型(MIME sniffing)、频率限制

**关联**:解 ISSUE-4、ISSUE-6 的前置条件。

---

#### ISSUE-4: 同一资产的多版本/多时期照片缺失

**现象**:同一个角色/场景/道具,在不同时期的照片无法存储,无法形成时间线。

**根因**:`storage/prisma/schema.prisma` 完全没有 `ImageAsset` 表。`storage/uploads/` 只存 TXT,没有图片目录结构。

**影响**:核心使用价值丧失——无法记录角色成长、场景变换、道具状态演化。

**修复方向**:
- 新增 `ImageAsset` 表(`groupId` + `capturedAt` + `isPrimary`)
- 时间线视图(按 `captured_at` 排序,主版本标记)
- 增量存储(相同图片去重)+ 多分辨率(原图 + 多级缩略图)

**建议**:新建独立 workspace 包 `@qunxiang/image-assets`,而不是堆到 `storage` 包。

---

#### ISSUE-5: 章节查询数据库繁忙

**现象**:访问章节 Tab 时频繁出现数据库繁忙错误。

**根因猜测**(需验证):
- SQLite 单文件,无读写分离
- `chapters` 表可能缺少 `(bookId, order)` 复合索引
- `web/` 章节 Tab 一次性拉全部章节,大书会触发全表扫描
- 无缓存层(项目目前没用 Redis)

**影响**:所有用户访问章节页都会受影响,不只是大书。

**修复方向**:
- 慢查询日志定位瓶颈
- 加 `(bookId, order)` 复合索引
- 章节内容分页/懒加载(不要一次拉全本)
- 热点章节 Redis 缓存(若引入 Redis;否则用 SQLite WAL 模式 + 内存缓存)

---

#### ISSUE-6: 重新打开后图片资产消失

**现象**:用户处理过的图片资产,刷新或重开应用后丢失。

**根因**:因为 ISSUE-3/ISSUE-4 未实现,资产本来就没存过,自然"消失"。

**影响**:严重损害用户信任——一旦补了上传,如果数据流没做对,还是会丢。

**修复方向**:
- 实现乐观更新 + 失败回滚
- 定期同步状态到后端
- 离线模式支持(IndexedDB + 同步队列)

**依赖**:依赖 ISSUE-3 + ISSUE-4 先落地,这是"持久化层做对"的额外保障。

---

### 🟡 P1 — 应当解决(体验与流程)

#### ISSUE-7: 管线某一阶段失败需要全部重新开始

**现象**:实体提取管线是串行流水线,任意阶段失败 → 全部从头。

**根因猜测**:`scheduler/src/` 的管线阶段化但**无 checkpoint**。中间产物 `api/.intermediate/` 可能存在,但调度器没记录"已完成到哪一步"。

**影响**:用户体验差(等待 5+ 分钟后失败);LLM 费用浪费(已通过的阶段还会被重跑)。

**修复方向**:
- 阶段级 checkpoint(每完成一个 stage,写入 `pipeline_runs` 表 + 中间产物落盘)
- 失败时记录断点,前端提供"从失败阶段继续"按钮
- 每个 stage 实现幂等(重复执行结果一致)
- 失败重试 vs 失败的提示区分(网络抖动重试 / 数据问题停止)

**风险**:涉及 `scheduler` 包架构调整,需要先盘点所有 stage 的输入/输出契约。

---

### 🟢 P2 — 可延后(基础设施 & 前端展示)

#### ISSUE-8: LLM 代理(Reve / 国内访问)配置无文档

**现象**:使用 Reve 等国内 LLM 服务需要代理,但 `LLM 设置` 页面没说怎么配。

**根因**:`web/src/components/LlmSettings.tsx` 只暴露了 API Key、Model、Base URL,没有"代理场景说明"。

**影响**:国内用户首次配置容易卡住。

**修复方向**:
- 在 `LLM 设置` 页面加 "需要代理?" 折叠帮助(说明把代理 URL 填到 Base URL 即可)
- 区分"自定义代理 URL" 与 "完整 /chat/completions URL" 的两种填法
- 给出常见服务(OpenAI / Azure / 国内代理)示例

**风险**:零,纯文档/UX 改动。

---

#### ISSUE-9: 视觉原文片段前端显示不出来

**现象**:后端 `visual-description.agent.ts` 已经标记了第几章和原文片段的对应关系,但前端没有渲染出来。

**根因猜测**(两个可能,需定位):
- 前端组件没读 `visualSegments` / `evidence` 字段
- 后端 `safeLlmFields`(约 644-678 行)在 ISSUE-1 修复之前,**清空或覆盖了原文片段**

**影响**:用户看不到证据链,审核体验下降。

**修复方向**:
- 先排查是前端没渲染还是后端没数据(读 API 响应结构)
- 前端加视觉片段组件(高亮对应章节区域)
- 与后端对齐字段命名(避免 visualSegments vs evidence vs sourceText 三个名字乱用)

**依赖**:ISSUE-1(测试相关)修了之后,这条的数据基础才能稳。

---

## 优先级矩阵

| 优先级 | ISSUE | 工作量 | 依赖 | 备注 |
|--------|-------|--------|------|------|
| 🔴 P0 | ISSUE-3 上传功能 | 2-3 天 | 无 | 解锁 4、6 |
| 🔴 P0 | ISSUE-4 多版本存储 | 2 天 | ISSUE-3 | 同包内 |
| 🔴 P0 | ISSUE-5 章节查询 | 1 天 | 无 | 独立可做 |
| 🔴 P0 | ISSUE-6 持久化保障 | 1 天 | ISSUE-3,4 | |
| 🟡 P1 | ISSUE-7 管线断点续传 | 3 天 | 无 | scheduler 改动 |
| 🟢 P2 | ISSUE-8 LLM 代理 UX | 0.5 天 | 无 | 纯文档 |
| 🟢 P2 | ISSUE-9 视觉片段显示 | 1 天 | 测试 ISSUE-1 修了之后 | |

## 下一步行动

1. ✅ 已完成:本节 7 项 issue 迁入并分级
2. ✅ 已完成:planner agent 出 P0(ISSUE-3 + ISSUE-4 + ISSUE-5 + ISSUE-6)详细实施方案
3. ✅ Phase A 完成(2026-07-09):
   - ISSUE-3 上传功能(POST /books/:id/image-assets + ImageUpload 组件)
   - ISSUE-4 多版本存储(ImageAsset model + ImageTimeline 组件 + setPrimary 事务)
   - ISSUE-5 章节查询(SQLite WAL + busy_timeout,缓解 SQLITE_BUSY)
   - ISSUE-6 持久化保障(后端事务 + 文件 rename + 前端 hook invalidate)
   - Book 删除时级联清理图片磁盘目录
4. ✅ Phase B/C/D 完成(2026-07-09):
   - 缩略图 service 层真实集成测试(sharp PNG→WebP 10 测试)
   - ImageTimeline UX(loading/防重复点击/错误占位符/modal a11y)
   - chapterContentCache + 大文件预警
5. ✅ ISSUE-7 管线断点续传完成(2026-07-09):
   - api: resumeExtraction service + POST /:id/extract/resume 路由
   - web: useResumeExtraction hook + PipelinePage "从失败处继续"按钮
   - 测试:6 个 case(无任务/运行中/全成功/从失败继续/不重跑上游/重置下游)
6. ⏳ 剩余:ISSUE-8 (LLM 代理 UX,0.5 天)+ ISSUE-9 (视觉片段,1 天)
7. ⏳ CI 中 `vitest` 与 `tsc` 仍是 `continue-on-error: true`:CI 环境没有 docker,集成测试跑不了;后续可给 CI 加 services(postgres/minio)后摘掉 continue-on-error
