# Known Issues — YingHe-entity

> 本文档记录当前仓库已知的未解决问题,与测试状态对应。
> 每次修一个 issue,把它从本文件移到 git commit message。

最后更新:2026-07-27

---

## 测试状态

```
Test Files:  96 passed (96)
Tests:       556 passed (556)
通过率:       100%
```

运行方式:`node scripts/test.mjs`(自动起 docker postgres-test + minio-test,跑前 `prisma migrate reset`,跑完清理容器)。

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

## 当前未修复的测试

无。

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

**建议**:新建独立 workspace 包 `@novel-agent/image-assets`,而不是堆到 `storage` 包。

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
