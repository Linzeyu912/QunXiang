# Story-Arcs 前端设计书（故事切分 → 故事资产 → 导演管线）

> **文档状态**：已实施（2026-07-02，M1+M2+M3 一次完成并通过端到端冒烟测试）。本文档保留原设计，实施与设计的偏差集中记录在下方「实施记录」。
> **配套后端规格**：`docs/superpowers/specs/2026-06-07-story-segmentation-director-agent-design.md`（权威数据契约来源）
> **后端代码**：`story-arcs/src/`（类型契约见 `story-arcs/src/types.ts`，已实现并有测试覆盖）
> **本文档目的**：任何 agent 或开发者可以只读本文档 + 上述两个源文件，独立完成前端实施/维护。

---

## 实施记录（2026-07-02，先读这个）

**落地文件**：
- 后端：`api/src/services/story.service.ts`（核心，含文件读写/任务注册/SSE）、`api/src/routes/stories.ts`、`api/src/routes/director.ts`，注册于 `api/src/index.ts`
- 前端：`web/src/types/story.ts`、`web/src/api/stories.ts`、`web/src/api/director.ts`、`web/src/pages/story/`（5 个页面）、`web/src/components/story/`（6 个组件）、`web/src/App.tsx` 与 `web/src/pages/BookLayout.tsx`（路由/Tab 接线）

**未决问题 Q1–Q5 的最终决定**：
- **Q1**：输出目录名直接用 `bookId`（`output/{bookId}/…`）。director-pipeline 内部写文件时本就硬编码 `bundle.story.bookId` 作目录名，用 slug 反而会分裂成两棵目录树。无映射、无 migration。
- **Q2**：切分自动带实体预扫（`parseTxtEnhanced(..., { useLLM: false })`，纯正则，秒级）。
- **Q3**：不做裁决撤销；裁错重新切分。
- **Q4**：重切分直接覆盖 + 前端 AlertDialog 确认；切分时清空 `output/{bookId}/stories/` 子树防止陈旧资产。不做归档。
- **Q5**：沿用现有匿名 JWT 放行策略，无新增认证。

**与原设计的两个重要偏差（基于代码现实）**：
1. **边界审核 v1 语义**：`story-arcs` 里没有 LLM BoundaryJudge/BoundaryReviewItem 实现（只在规格里）。实际切分入口是确定性的 `buildStorySegmentsFromParseResult`。因此 v1 审核项由服务端**派生**：`boundaryConfidence < 0.82` 的段生成一条审核项（结构见 `story.service.ts` 的 `BoundaryReviewApiItem`），裁决动作是 `confirm`（确认边界）/ `merge_with_previous`（并入上一段，确定性合并，合并后该段 `approved` 重置为 false 且两段旧资产目录被清除）。原设计的 `same_story/new_story` 决策语义留待后端真正实现 BoundaryJudge 后升级。
2. **资产提取与导演管线是同步端点**：两者都是确定性纯函数（无 LLM），毫秒级完成，直接在 POST 请求内执行并返回结果。原设计的「POST → SSE → GET」三段式只保留给切分（parseTxtEnhanced 对长书可达秒~十秒级）。`POST /assets/extract` 直接返回 `StoryAssetPack`；`POST /director/assignments` 直接返回 `AssignmentWithStatus`（status: completed/failed）。
3. 分镜/视频提示词端点不用 404/409 表达阻塞态，统一返回 200 + `{ pack, reason?: 'not_generated'|'review_blocked', review? }`，前端好处理。

**持久化文件为包装对象**（非裸数组）：`story-segments.json` = `{ bookId, generatedAt, segments }`；`story-boundary-review.json` = `{ bookId, items }`；`director-assignments.json` = `{ bookId, assignments }`（assignments 按时间倒序 unshift）。

**前端类型接入方式**：web 的 tsconfig `paths` 增加了 `"@novel-agent/story-arcs/types": ["../story-arcs/src/types.ts"]`，`web/src/types/story.ts` 只从这个映射做 `export type` 重导出。**不能从包根 `@novel-agent/story-arcs` 导入**——包根 index 会把含 Node fs 依赖的整个源码图拉进浏览器端 tsc program（已踩坑验证）。

**冒烟测试结果**（书：《斗破苍穹》30 章样本）：切分 5 段 → 审批 → 资产 9 角色/1 场景/6 道具/16 提示词 → 导演任务 completed → 1 集剧本过审 → 4 分镜帧 + 4 视频片段；PATCH 修复描述后 quality 变 sufficient；错误路径 404/409/400 均正确。**未经运行时验证的路径**：`merge_with_previous` 合并裁决（该样本书所有段置信度 ≥0.82，队列为空；合并逻辑为纯数据操作，有需要时用无预扫事件的书触发 fallback 切分即可复现低置信段）。

**已知存量问题（非本次引入）**：`pnpm --filter @novel-agent/api exec tsc --noEmit` 会报 8 个 `scheduler` 包的既有类型错误（`prompt-generation` 未加入 AgentType 联合）；api 用 tsx 跑 dev 不受影响。web 的 `pnpm lint` 因 devDependencies 缺 `@eslint/js` 本来就无法运行。

---

## M4 实施记录（2026-07-02 第二批）

**已完成**：
- **批量审批 UI**（P1）：头部「批量审批」切换按钮 → 列表项出现复选框 + 操作条（全选待审批/清空/审批所选/撤销所选），走 `POST /stories/approve-batch`，逐条报告 skipped 原因。
- **快捷键**：P1 新增 `A` = 审批/撤销当前选中段；P3 资产列表新增 J/K 与 ↑↓ 导航（仅激活 Tab 挂载，不跨 Tab 冲突；`useKeyboardShortcuts` 自带输入框守卫，编辑描述时不会误触）。
- **原文对照**（P5）：剧集页头部「查看原文」Dialog，懒加载故事段 `sourceText`，供剧本 sourceReferences 对照。
- **切分参数透传**：修复实现缺口——`POST /stories/segment` 现在接收 body 的 `maxChaptersPerSegment` / `autoApprove`（此前契约里写了但实现忽略了 body）。
- **删除书籍级联清理**：`DELETE /books/:id` 现在会同时删除 `output/{bookId}/` 与 `.intermediate/story/{bookId}/`（此前留孤儿产物）。
- **merge_with_previous 运行时验证补全**：用无事件关键词的合成书触发 fallback 切分（3 段 × conf 0.78 → 3 条审核项），完整验证：未决审核时审批 409 → 合并裁决（3 段变 2 段，ch0-1 + ch2-3 → ch0-3）→ confirm 剩余 → pendingCount 归零 → 审批 200 → 批量审批 200。首段 canMerge=false 正确。
- 空态/错误态审计：五个页面的空态均带下一步动作按钮（切分/去审批/去提取/去导演台），分镜/视频被剧本审核阻塞时展示 issues 而非裸空态。

**明确不做（v1 范围决定）**：
- P4 表单不暴露 `episode_revision` 任务类型（后端支持；等有真实修订需求再加 episodeNos 选择 UI）。
- 上传路由对 git-bash curl 的 multipart 文件名编码敏感（中文文件名会乱码入库）——浏览器上传不受影响，不修。

**留给后续 agent 的事项（按优先级）**：
1. **浏览器走查**：本次验证覆盖了 API 层端到端 + tsc/vite build，但五个新页面没有真人在浏览器里点过。跑 `pnpm --filter @novel-agent/api dev` + `pnpm --filter @novel-agent/web dev`，用 `D:\YH\YingHe-entity-dev\storage` 库里已有的《斗破苍穹》（bookId 549def18…）把 §4 用户流程走一遍，重点看：批量审批操作条、边界审核页（需要一本触发 fallback 的书，参考实施记录里的合成书方法）、资产描述编辑保存后的警告横幅刷新。
2. **章节覆盖稀疏问题（需要产品决策）**：真实小说 30 章样本只切出 5 段（ch2/5-7/13/26/28-29），其余章节不属于任何故事段——这是 story-arcs 弧线切分「只挑高信号弧」的设计使然，不是 bug。若业务上要求全书章节全覆盖，需要在后端给弧线之间的空隙生成 fallback 段（改 `buildStorySegmentsFromParseResult`），或在前端明示「未覆盖章节」。建议先问用户预期。
3. **前端 SSE 兜底轮询的可靠性**：`useSegmentationProgress` 的 EventSource + 轮询兜底逻辑只在正常路径下验证过，SSE 中断场景（服务器重启）未实测。
4. 两个存量问题（见上）：scheduler 类型错误、eslint 依赖缺失——都与本功能无关，但迟早要清。

---

## 0. 交接必读（给接手实施的 agent）

1. **不要发明数据结构**。所有类型以 `story-arcs/src/types.ts` 为唯一事实来源，前端通过 `import type` 重导出（见 §6）。
2. **先做 M1（只读），再做写路径**。分期计划见 §12，每期结束都有可验证的验收标准。
3. **API 尚不存在**。`api/src/routes/` 里没有任何 story 路由，需按 §5 契约新建 `api/src/routes/stories.ts` 和 `api/src/routes/director.ts`。第一版后端实现直接读写 `output/{bookDirName}/` 下的 JSON 文件（布局见 §2.3），不动 Prisma。
4. **沿用现有前端约定**：React 18 + Vite + TanStack Query v5 + react-router v6 + Tailwind + shadcn/ui（Radix）+ sonner + lucide-react。参考实现范本：
   - 双栏审核页范本：`web/src/pages/EntityReviewPage.tsx`
   - API hooks 范本：`web/src/api/extraction.ts`（含 SSE + 轮询兜底）
   - fetch 封装：`web/src/api/client.ts`（`apiFetch`，勿另造）
   - Tab 导航范本：`web/src/pages/BookLayout.tsx`
5. **验证命令**：`pnpm --filter @novel-agent/web dev`（前端）、`pnpm --filter @novel-agent/api dev`（后端）、`pnpm --filter @novel-agent/web build`（类型检查）。
6. 未决问题集中在 §13，实施中遇到即问用户，不要自行拍板。

---

## 1. 背景与目标

后端已实现一条与实体提取管线**完全独立**的故事改编管线（`story-arcs` 包）：

```text
TXT 章节（parseTxtEnhanced，复用现有）
  → 叙事事件/故事弧分析（narrative-events, analyzer）
  → 故事段切分（story-segments）           ← 边界不确定时产生 needs_review，阻塞
  → 故事段审批（StorySegment.approved）     ← 人工门禁
  → 故事资产提取（角色/场景/道具 agent）      ← candidate 资产非阻塞，附警告
  → 资产视觉提示词（asset-prompts）
  → 导演任务（DirectorAssignment）          ← 用户指定改编哪些已审批故事
  → 剧集规划（episode-planner）
  → 剧本生成（director-agent）
  → 剧本审核（script-reviewer）             ← accepted=false 则不产分镜/视频提示词
  → 分镜提示词包（storyboard-prompt-agent）
  → 视频提示词包（video-prompt-agent）
```

当前状态：**纯库代码 + 文件输出，API 零暴露，前端零覆盖**。后端规格明确写了"第一版不做前端，评审项存 JSON 文件，未来前端消费同样的文件或持久化记录"——本设计书就是这个"未来前端"，并连带定义 API 契约。

**目标**：让用户在现有 Web 界面内完成：① 边界审核 ② 故事段审批 ③ 故事资产查看与描述修复 ④ 发起导演任务 ⑤ 查看剧本/分镜提示词/视频提示词并导出。

**非目标**：不做图像/视频生成（后端也只产提示词包）；不改动现有实体审核流；不做多用户协作。

---

## 2. 后端现状摘要（前端视角）

### 2.1 核心类型（均在 `story-arcs/src/types.ts`）

| 类型 | 作用 | 前端消费场景 |
|---|---|---|
| `StorySegment` | 故事段：章节范围、标题、摘要、核心冲突、触发、转折点、冲突状态、主/配角、地点、边界置信度、`approved` | 故事列表页、故事详情、审批 |
| `NarrativeEvent` / `NarrativeArc` | 叙事事件与弧线（切分依据） | 故事详情的证据展示（可选） |
| `CharacterInStory` / `SceneInStory` / `PropInStory` | 故事内资产，含 `confidence`、`assetStatus`(confirmed/candidate)、`descriptionQuality`(sufficient/thin/missing)、`needsDescriptionRepair`、`visualPrompt`、`evidenceSnippets` | 资产页三个 Tab |
| `StoryAssetPack` | 三类资产聚合 + `assetWarnings` | 资产页顶部警告横幅 |
| `StoryAssetVisualPrompt` / `StoryAssetPromptPack` | 资产级图像提示词（prompt/negativePrompt/metadata） | 资产页"提示词"Tab，复制/导出 |
| `DirectorAssignment` | 导演工单：`assignmentType`(single_story/story_batch/episode_revision)、`storyIds`、`objective`、`styleNotes`、`constraints`、`requestedBy` | 导演工作台创建表单 |
| `ScriptEpisodePlan` | 剧集规划：hook/冲突/转折/结尾钩/预估时长 | 剧集页规划卡 |
| `ScriptEpisode` | 剧本：场景数组（地点/角色/动作/逐行台词/镜头）、导演笔记、来源引用 | 剧本阅读视图 |
| `ScriptReview` | 剧本审核：`accepted`、issues(blocker/warning) | 剧本页审核结果条 |
| `StoryboardPromptPack` / `StoryboardFramePrompt` | 分镜帧提示词：shotType、beat、visualPrompt、视觉连续性引用 | 分镜 Tab 帧网格 |
| `VideoPromptPack` / `VideoClipPrompt` | 视频片段提示词：时长、motion、cameraMovement、连续性笔记 | 视频 Tab 片段列表 |

规格文档中还有两个**尚未在 types.ts 落地**的契约（边界审核靠它）：`ChapterAnalysis` 和 `BoundaryReviewItem`（字段见规格 §Data Contracts）。API 层需按规格定义透传，前端按规格建类型。

### 2.2 关键业务规则（前端必须体现的门禁）

1. **边界安全规则**：候选故事段内只要有一个边界是 `needs_review`，该段就不能被审批、不能进入下游。前端表现：该段显示"待边界裁决"状态，审批按钮禁用并指向边界审核队列。
2. **审批门禁**：`runDirectorPipelineForStory` 对未审批故事直接抛错。前端表现：导演工作台的故事多选框**只列出 approved 的故事段**。
3. **candidate 资产非阻塞**：低置信资产照常展示，但要用徽章区分 confirmed/candidate，`needsDescriptionRepair=true` 的资产高亮并支持人工修复描述。
4. **剧本审核不通过 → 无分镜/视频**：`ScriptReview.accepted=false` 时 storyboard/video prompt pack 为空数组。前端表现：分镜/视频 Tab 显示"剧本审核未通过"及 issues 列表，而不是空态。
5. **边界裁决阈值**（展示用）：`confidence >= 0.82` 自动通过；`0.65~0.82` 产生审核项；`< 0.65` 产生强警告审核项。前端置信度条用同一阈值着色（绿/黄/红）。

### 2.3 文件输出布局（第一版 API 的数据源）

```text
output/{bookDirName}/
  chapter-analysis.json
  story-boundary-decisions.json
  story-boundary-review.json        ← BoundaryReviewItem[]，边界审核队列
  story-segments.json               ← StorySegment[]
  story-context-packs.json
  director-assignments.json         ← DirectorAssignment[]
  script-episode-plans.json
  script-episodes.json
  storyboard-prompt-packs.json
  video-prompt-packs.json
  stories/{storyId}/
    story.json                      ← StorySegment
    characters.json / scenes.json / props.json
    asset-pack.json                 ← StoryAssetPack（含 warnings）
    character-prompts.json / scene-prompts.json / prop-prompts.json
    asset-prompts.json              ← StoryAssetPromptPack
    director/
      director-assignment.json
      episode-plan.json
      script-episodes.json
      script-review.json
      storyboard-prompt-pack.json
      video-prompt-pack.json
```

注意：`storyAssetDirectory(outputDir, bookDirName, storyId)` 用的是 `bookDirName`（可读 slug），不一定等于数据库 `bookId`。API 层需要维护 bookId → bookDirName 的映射（第一版可在触发切分时把 dirName 记录到一个 `output/{bookDirName}/meta.json` 或由 API 服务内存/DB 记录，见 §13 未决问题 Q1）。

---

## 3. 信息架构与路由设计

在现有 `BookLayout` 的 Tab 行新增两个 Tab：**故事**、**导演**。故事管线独立于实体提取管线，因此这两个 Tab **不受 `isComplete`（实体提取完成）门禁约束**——书上传后即可用。

```text
/library                                    （现有）
/books/:bookId                              （现有 BookLayout）
  /pipeline                                 （现有：实体提取管道）
  /characters | /locations | /items         （现有：实体审核）
  /export                                   （现有：实体导出）
  /stories                                  【新】P1 故事段列表 + 详情（双栏）
  /stories/boundary-review                  【新】P2 边界审核队列
  /stories/:storyId/assets                  【新】P3 故事资产（角色/场景/道具/提示词 4 Tab）
  /stories/:storyId/episodes                【新】P5 剧集：规划/剧本/分镜/视频 4 Tab
  /director                                 【新】P4 导演工作台（创建任务 + 历史）
/settings/llm                               （现有）
```

面包屑/返回逻辑：P3、P5 头部显示所属故事段标题，返回箭头回 P1 并保持选中态（通过 `?sel=` 查询参数，沿用 EntityReviewPage 的模式）。

---

## 4. 用户流程（端到端）

```text
① 书库上传 TXT（现有流程）
② 进入「故事」Tab → 点击「开始故事切分」 → SSE 进度 → 产出候选故事段
③ 若有待审边界：Tab 上出现红点徽章 → 进入边界审核队列逐条裁决（同一故事/新故事）
   → 全部裁决后后端重新组装故事段
④ 逐段查看故事详情 → 点「审批」把 approved 置 true（可批量）
⑤ 对已审批故事触发「提取资产」→ 查看角色/场景/道具 → 修复 thin/missing 描述
⑥ 进入「导演」Tab → 勾选已审批故事 + 目标(草拟剧本) + 风格/约束 → 创建导演任务
⑦ 任务完成后进入 P5：读剧本 → 看审核结果 → 分镜提示词/视频提示词逐条复制或整包导出
```

---

## 5. API 契约设计

**总原则**：REST + JSON，挂在现有 Fastify 实例下；异步流程用「POST 触发 → SSE 推进度 → GET 拉结果」三段式，与现有 `/books/:id/extract` 完全同构。所有响应错误格式沿用 `{ error: string }`。

### 5.1 故事切分与故事段（新文件 `api/src/routes/stories.ts`，前缀 `/books`）

| 方法 | 路径 | 请求 | 响应 | 说明 |
|---|---|---|---|---|
| POST | `/books/:id/stories/segment` | `{ maxChaptersPerSegment?, autoApprove? }` | `{ taskId, message }` | 触发切分管线（章节分析→边界判定→组段）。幂等：运行中重复调用返回同一 taskId |
| GET | `/books/:id/stories/segment/status` | `?taskId=` | `{ status: 'pending'\|'running'\|'completed'\|'failed', progress: number, message? }` | 轮询兜底 |
| GET | `/books/:id/stories/segment/stream` | — | SSE | 事件见 §5.4 |
| GET | `/books/:id/stories` | — | `{ stories: StorySummary[], pendingBoundaryReviews: number }` | 列表页主数据。`StorySummary` 为 `StorySegment` 去掉 `sourceText`（正文可达数十万字，**列表接口绝不返回 sourceText**） |
| GET | `/books/:id/stories/:storyId` | `?includeSource=true` | `StorySegment`（默认不含 sourceText，带参数才含） | 详情 |
| POST | `/books/:id/stories/:storyId/approve` | `{ approved: boolean }` | 更新后的 `StorySummary` | 审批/撤销。若该段仍有未决边界 → 409 `{ error: 'unresolved boundary reviews' }` |
| POST | `/books/:id/stories/approve-batch` | `{ storyIds: string[], approved: boolean }` | `{ updated: string[], skipped: {storyId, reason}[] }` | 批量审批 |

### 5.2 边界审核

| 方法 | 路径 | 请求 | 响应 | 说明 |
|---|---|---|---|---|
| GET | `/books/:id/stories/boundary-reviews` | `?status=pending\|resolved` | `{ items: BoundaryReviewItem[] }` | 队列。`BoundaryReviewItem` 按规格 §Data Contracts，API 层补充 `status: 'pending'\|'resolved'` 与 `resolvedDecision?` 字段 |
| POST | `/books/:id/stories/boundary-reviews/:reviewId/resolve` | `{ decision: 'same_story' \| 'new_story', note? }` | `{ item, resegmented: boolean, pendingCount: number }` | 裁决一条。后端记录裁决；当 `pendingCount === 0` 时后端自动用人工裁决重跑组段（`resegmented: true`），前端据此失效故事列表缓存 |

### 5.3 故事资产、导演任务、剧集产物

| 方法 | 路径 | 请求 | 响应 | 说明 |
|---|---|---|---|---|
| POST | `/books/:id/stories/:storyId/assets/extract` | — | `{ taskId }` | 触发资产提取（要求已审批，否则 409） |
| GET | `/books/:id/stories/:storyId/assets` | — | `StoryAssetPack` | 含 `assetWarnings` |
| GET | `/books/:id/stories/:storyId/asset-prompts` | — | `StoryAssetPromptPack` | 资产提示词 |
| PATCH | `/books/:id/stories/:storyId/assets/:assetType/:assetName` | `{ description?, visualPrompt?, appearanceDescription? }` | 更新后的单个资产 | 人工修复描述；后端置 `descriptionQuality='sufficient'`、`needsDescriptionRepair=false` 并移除对应 warning。`assetType ∈ character\|scene\|prop`，`assetName` URL-encode |
| POST | `/books/:id/director/assignments` | `{ assignmentType, storyIds, objective, styleNotes?, constraints?, episodeNos? }` | `{ assignment: DirectorAssignment, taskId }` | 创建并立即执行导演管线。校验 storyIds 全部 approved，否则 400 列出违规 id。`requestedBy` 由后端固定为 `'user'` |
| GET | `/books/:id/director/assignments` | — | `{ assignments: AssignmentWithStatus[] }` | 历史列表。`AssignmentWithStatus = DirectorAssignment & { status, error? }` |
| GET | `/books/:id/stories/:storyId/episodes` | — | `{ plans: ScriptEpisodePlan[], episodes: ScriptEpisode[], review: ScriptReview \| null }` | 剧集页主数据 |
| GET | `/books/:id/stories/:storyId/episodes/:episodeNo/storyboard` | — | `StoryboardPromptPack`；404=尚未生成；409+review=剧本未过审 | 分镜提示词 |
| GET | `/books/:id/stories/:storyId/episodes/:episodeNo/video-prompts` | — | `VideoPromptPack`（404/409 同上） | 视频提示词 |

### 5.4 SSE 事件契约（`/books/:id/stories/segment/stream`，导演任务复用同结构、路径 `/books/:id/director/stream`）

```jsonc
// event: progress
{ "type": "stage-started" | "stage-completed" | "stage-failed",
  "stage": "chapter-analysis" | "boundary-judge" | "segment-assembly"
         | "asset-characters" | "asset-scenes" | "asset-props" | "asset-prompts"
         | "episode-plan" | "script" | "script-review" | "storyboard-prompts" | "video-prompts",
  "taskId": "…", "message": "…", "timestamp": 1730000000000 }
// event: review-needed   —— 切分过程中产生了待审边界
{ "type": "review-needed", "pendingCount": 3 }
// event: done / error
{ "type": "done", "taskId": "…" } / { "type": "error", "message": "…" }
```

### 5.5 第一版后端实现说明（文件直读版）

- 新建 `api/src/services/story.service.ts`：包装 `@novel-agent/story-arcs` 的纯函数 + `fs` 读写 §2.3 布局的 JSON；内存 Map 维护 taskId → 进度（与 `extraction.service.ts` 的做法一致）。
- 裁决与人工修复**直接改写对应 JSON 文件**（`story-boundary-review.json`、`stories/{storyId}/*.json`），保持文件是唯一事实来源，后续迁 Prisma 时前端契约不变。
- 挂载：`api/src/index.ts` 里 `await fastify.register(storiesRoutes, { prefix: '/books' });` 与 `directorRoutes`。

---

## 6. 前端类型策略

新建 `web/src/types/story.ts`，**用 type-only 重导出**避免双维护（story-arcs 的 `types.ts` 是纯类型文件，`import type` 编译期擦除，不会把任何 Node 代码打进 bundle）：

```ts
// web/src/types/story.ts
// 单一事实来源：story-arcs/src/types.ts。只允许 type 导入，禁止值导入（会拖入 Node fs 依赖）。
export type {
  StorySegment, StoryConflictStatus, NarrativeEvent, NarrativeArcType,
  CharacterInStory, SceneInStory, PropInStory,
  StoryAssetPack, AssetWarning, StoryAssetStatus, DescriptionQuality,
  StoryAssetPromptPack, StoryAssetVisualPrompt,
  DirectorAssignment, ScriptEpisodePlan, ScriptEpisode, ScriptScene, ScriptDialogueLine,
  ScriptReview, StoryboardPromptPack, StoryboardFramePrompt,
  VideoPromptPack, VideoClipPrompt,
} from '@novel-agent/story-arcs';

// —— 以下为 API 层扩展类型（story-arcs 里没有，按本设计书 §5 定义）——

/** 列表用摘要：StorySegment 去掉 sourceText */
export type StorySummary = Omit<StorySegmentT, 'sourceText'>;
type StorySegmentT = import('@novel-agent/story-arcs').StorySegment;

export type BoundaryDecision = 'same_story' | 'new_story';

/** 规格文档 BoundaryReviewItem + API 状态扩展 */
export interface BoundaryReviewItem {
  id: string;
  bookId: string;
  betweenChapter: [number, number];
  suggestedDecision: BoundaryDecision;
  confidence: number;
  reason: string;
  evidence: {
    continuingConflicts: string[];
    resolvedConflicts: string[];
    newConflicts: string[];
    continuingCharacters: string[];
    changedCharacters: string[];
    goalShift?: string;
  };
  leftChapterSummary: string;
  rightChapterSummary: string;
  status: 'pending' | 'resolved';
  resolvedDecision?: BoundaryDecision;
}

export type StoryTaskStage =
  | 'chapter-analysis' | 'boundary-judge' | 'segment-assembly'
  | 'asset-characters' | 'asset-scenes' | 'asset-props' | 'asset-prompts'
  | 'episode-plan' | 'script' | 'script-review' | 'storyboard-prompts' | 'video-prompts';

export interface AssignmentWithStatus extends DirectorAssignmentT {
  status: 'pending' | 'running' | 'completed' | 'failed';
  error?: string;
}
type DirectorAssignmentT = import('@novel-agent/story-arcs').DirectorAssignment;
```

同时在 `web/package.json` 增加 `"@novel-agent/story-arcs": "workspace:*"`。

---

## 7. 数据层设计（TanStack Query）

新建 `web/src/api/stories.ts` 与 `web/src/api/director.ts`。Query key 规范：

```ts
export const storiesKey = {
  all: (bookId: string) => ['stories', bookId] as const,
  list: (bookId: string) => ['stories', bookId, 'list'] as const,
  detail: (bookId: string, storyId: string) => ['stories', bookId, 'detail', storyId] as const,
  boundaryReviews: (bookId: string) => ['stories', bookId, 'boundary-reviews'] as const,
  assets: (bookId: string, storyId: string) => ['stories', bookId, 'assets', storyId] as const,
  assetPrompts: (bookId: string, storyId: string) => ['stories', bookId, 'asset-prompts', storyId] as const,
  episodes: (bookId: string, storyId: string) => ['stories', bookId, 'episodes', storyId] as const,
  storyboard: (bookId: string, storyId: string, ep: number) => ['stories', bookId, 'storyboard', storyId, ep] as const,
  videoPrompts: (bookId: string, storyId: string, ep: number) => ['stories', bookId, 'video', storyId, ep] as const,
};
export const directorKey = {
  assignments: (bookId: string) => ['director', bookId, 'assignments'] as const,
};
```

失效规则（写操作 → 需要 invalidate 的 key）：

| 写操作 | 失效 |
|---|---|
| 切分完成（SSE done） | `storiesKey.all(bookId)` 整棵 |
| 裁决边界（`resegmented=true` 时） | `boundaryReviews` + `list`（重组段会改变故事列表） |
| 裁决边界（`resegmented=false`） | 仅 `boundaryReviews`（用响应做乐观更新） |
| 审批/批量审批 | `list` + `detail(storyId)` |
| 资产提取完成 | `assets` + `assetPrompts` |
| 修复资产描述 | `assets`（用 PATCH 响应就地 setQueryData，免重拉） |
| 创建导演任务 / 任务完成 | `directorKey.assignments` + `episodes` + `storyboard` + `videoPrompts` |

SSE 集成沿用 `web/src/api/extraction.ts` 的成熟模式：`useEffect` 中开 `EventSource`，事件合并进 query cache，`refetchInterval` 10s 兜底轮询、任务不在运行时停轮询。**直接复制该文件的 `mergeEventIntoStages` 思路改造，不要重新发明。**

---

## 8. 页面设计

### P1 故事段列表 + 详情 `/books/:bookId/stories`

**目的**：一屏完成"看全书切分结果 → 逐段确认 → 审批"。

```text
┌──────────────────────────────────────────────────────────────┐
│ 故事切分  12 段 · 3 段待审批            [⚠ 边界审核 (2)] [开始切分] │
├──────────────────┬───────────────────────────────────────────┤
│ ▸ 第1-3章 牢狱自救 │  牢狱自救                    [✓已审批] [资产→] │
│   ✓已审批 ▓▓▓ 0.91│  章节：第1-3章 · 冲突状态：部分解决              │
│ ▸ 第4-7章 桑泊案   │  边界置信度 ▓▓▓▓░ 0.86                      │
│   ●待审批 ▓▓▓ 0.86│  ─────────────────────────────              │
│ ▸ 第8章 ？边界待裁 │  摘要：许七安在牢房中尝试自救…                  │
│   ⊘待边界审核      │  核心冲突：必须在狱卒逼近前脱身                  │
│   …              │  触发：许七安被关押                            │
│                  │  转折点：· 狱卒逼近 · 铜牌成为关键线索            │
│                  │  主角：许七安 │ 配角：采薇 │ 地点：牢房           │
│                  │  [查看原文▾]（懒加载 includeSource）            │
│                  │  ────────────────────────────               │
│                  │  [审批本段] [取消审批]  [提取资产] [查看剧集→]     │
└──────────────────┴───────────────────────────────────────────┘
```

- 左列 = 时间线列表（按 `startChapter` 排序），每项：章节范围、标题、审批状态徽章、边界置信度迷你条（≥0.82 绿 / 0.65–0.82 黄 / <0.65 红）。
- 有未决边界的候选段：灰化 + "待边界审核"徽章，点击审批按钮时 toast 引导去 P2。
- 顶部"边界审核 (n)"按钮带红点计数（来自列表接口的 `pendingBoundaryReviews`）。
- "开始切分"触发 POST + SSE 进度条（复用 `StageCard`/`Progress` 组件的样式语言）；重复切分需 `AlertDialog` 确认"将覆盖现有切分与审批状态"。
- 选中态用 `?sel=storyId`，J/K 快捷键换段（复用 `useKeyboardShortcuts`）。
- 空态：还没切分过 → 居中大按钮"开始故事切分"+ 一句管线说明。

### P2 边界审核队列 `/books/:bookId/stories/boundary-review`

**目的**：逐条裁决 `needs_review` 边界，这是全管线唯一的**阻塞型**人工节点，交互要快。

```text
┌──────────────────────────────────────────────────────────────┐
│ ← 返回故事列表   边界审核  剩余 2 条            建议:新故事 · 0.71 ▓▓░│
├──────────────────────────────────────────────────────────────┤
│  第7章结尾摘要                 ┃  第8章开头摘要                    │
│  桑泊案告破，许七安受赏…        ┃  平远伯府深夜起火，新的案件…         │
├──────────────────────────────────────────────────────────────┤
│ 证据                                                          │
│  延续冲突: (无)          解决冲突: 桑泊案                         │
│  新冲突: 平远伯府纵火     延续角色: 许七安                         │
│  变化角色: +李玉春 -采薇  目标转移: 破案→新案                      │
│ AI 理由: 前一冲突已解决且新目标出现，但主角连续……                    │
├──────────────────────────────────────────────────────────────┤
│      [◀ 上一条]   [同一故事 (S)]   [新故事 (N)]   [下一条 ▶]       │
└──────────────────────────────────────────────────────────────┘
```

- 卡片式单条流（非表格）：左右章节摘要对比 + 证据分组（用不同色 Badge 列出延续/解决/新增冲突、角色变化、目标转移）+ AI 建议决策与置信度。
- 快捷键 S=同一故事、N=新故事、←→ 导航；裁决即 POST，乐观更新剩余计数。
- 全部裁决完（响应 `pendingCount===0 && resegmented=true`）：全屏成功态"边界已全部裁决，故事段已重新组装"+ 按钮回 P1（此时 P1 缓存已被失效重拉）。
- 决策不可轻率撤销：本期不做"撤销裁决"，裁错了重新跑切分（§13 Q3）。

### P3 故事资产页 `/books/:bookId/stories/:storyId/assets`

**目的**：审看三类资产质量，修复 thin/missing 描述，为图像生成备好提示词。

```text
┌──────────────────────────────────────────────────────────────┐
│ ← 牢狱自救(第1-3章)   故事资产        [重新提取资产]               │
│ ⚠ 2 条资产警告：铜牌缺少外观描述；采薇描述过薄        [展开全部]      │
├──────────────────────────────────────────────────────────────┤
│ [角色 4] [场景 3] [道具 2] [提示词 9]                            │
├──────────────────┬───────────────────────────────────────────┤
│ ▸ 许七安 主角     │ 许七安            [confirmed] 置信 ▓▓▓▓ 0.88 │
│   confirmed 0.88 │ 角色定位：主角 · 首现第1章 · 末现第3章           │
│ ▸ 采薇 配角 ⚠     │ 动机：脱困并保护采薇                           │
│   candidate 0.44 │ 与冲突的关系：被关押者，冲突核心                  │
│   …              │ 关键行动：· 藏铜牌 · 密谋越狱                   │
│                  │ ── 描述（quality: thin ⚠ 需修复）───────────  │
│                  │ ┌ 可编辑 textarea（description）┐ [保存]       │
│                  │ ── 外观描述 / visualPrompt 同款可编辑块 ──      │
│                  │ ── 证据片段（折叠，引用原文+章节号）──            │
└──────────────────┴───────────────────────────────────────────┘
```

- 双栏布局直接复用 `EntityReviewPage` 的骨架与 `ConfidenceBar`。
- Tab 间共享选中逻辑；"提示词"Tab 为只读列表：每条 `StoryAssetVisualPrompt` 显示 prompt/negativePrompt + 单条复制按钮 + 整包"复制 JSON / 下载 JSON"。
- `needsDescriptionRepair=true`：列表项黄色警示点，详情内 description/visualPrompt 变为可编辑（PATCH 保存，成功后 sonner toast + 就地更新缓存，顶部警告横幅计数同步减一）。
- 资产未提取空态：居中按钮"提取本故事资产"（故事未审批时禁用，提示先审批）。

### P4 导演工作台 `/books/:bookId/director`

**目的**：把"选哪些故事、干什么、什么风格"的 DirectorAssignment 语义直接表单化。

```text
┌──────────────────────────────────────────────────────────────┐
│ 新建导演任务                                                    │
│ 任务类型: (•)单故事 ( )多故事批量 ( )剧集修订                      │
│ 选择故事(仅已审批): [✓] 第1-3章 牢狱自救  [ ] 第4-7章 桑泊案        │
│ 目标: (•)草拟剧本 ( )修订剧本 ( )生成分镜提示词                     │
│ 风格笔记: [短剧节奏] [强开场钩子] [冲突可视化] [+自定义]             │
│ 约束:     [不得改写故事边界] [不得加入未支持的重大事实] [+]           │
│                                              [创建并运行 ▶]     │
├──────────────────────────────────────────────────────────────┤
│ 任务历史                                                       │
│ #a3f2 单故事·牢狱自救·草拟剧本  ✓完成 07-02 14:30  [查看产物→]      │
│ #b8c1 单故事·桑泊案·草拟剧本    ✗失败: LLM超时      [重试]          │
└──────────────────────────────────────────────────────────────┘
```

- 故事多选列表只请求 approved 段；一个都没有时表单禁用，显示引导"先到故事页审批至少一段"。
- 风格笔记/约束用 tag 输入（默认值 = 后端 `defaultAssignment` 的默认数组，允许增删）。
- 创建后行内 SSE 进度（阶段：剧集规划→剧本→审核→分镜提示词→视频提示词）；完成后"查看产物"跳 P5。
- `episode_revision` 类型追加 episodeNos 多选（来源：该故事现有剧集号）。

### P5 剧集与产物页 `/books/:bookId/stories/:storyId/episodes`

**目的**：阅读剧本、看审核结论、拿到分镜/视频提示词。

- **Tab 1 规划**：`ScriptEpisodePlan[]` 卡片网格 —— 每卡：集号、标题、hook、本集冲突、转折、结尾钩、预估时长。
- **Tab 2 剧本**：左侧剧集选择（多集时），右侧剧本阅读流：
  - 头部：标题/时长/hook/核心冲突 + `ScriptReview` 结果条（accepted 绿条；否则红条列 blocker、黄条列 warning）；
  - 正文：`ScriptScene` 卡片序列 —— 场景号+地点+出场角色 Badge → 动作段落 → 台词列表（说话人加粗、情绪为灰色小标签）→ 镜头备注；
  - 尾部：结尾钩、导演笔记、来源引用（章节号，点击可跳查看原文段落——M4 再做跳转，先纯文本）。
- **Tab 3 分镜提示词**：`StoryboardFramePrompt[]` 帧卡网格（frameNo/shotType 图标/beat/角色/情绪/camera + visualPrompt 代码块 + 单帧复制）；顶部显示 visualContinuity（styleGuide + 角色/场景/道具引用 Badge）与 `productionBoardPrompt` 整块复制；右上"下载整包 JSON"。
- **Tab 4 视频提示词**：`VideoClipPrompt[]` 列表（clipNo/时长/motion/cameraMovement/对白/soundNotes/continuityNotes + prompt 代码块复制）；顶部 globalContinuity（含 aspectRatio/目标时长）；未指定 targetSkill 时显示"模型无关提示词"徽章。
- Tab 3/4 在剧本未过审时整体替换为"剧本审核未通过"说明 + issues 列表 + 按钮"回剧本 Tab"。
- 空态（还没跑过导演任务）：引导按钮跳 P4。

---

## 9. 组件清单

**直接复用（勿重写）**：`ConfidenceBar`、`StatusBadge`（扩展一个 `StoryApprovalBadge` 变体）、`ui/*` 全套、`useKeyboardShortcuts`、`FileDropzone`（不用）、`StageCard`（切分/导演进度条改造复用）。

**新增（放 `web/src/components/story/`）**：

| 组件 | 用途 | 关键 props |
|---|---|---|
| `StoryListItem` | P1 左列时间线项 | `story: StorySummary; selected; onSelect` |
| `BoundaryConfidenceBar` | 三段阈值着色置信条 | `value: number`（0.82/0.65 阈值内置） |
| `AssetWarningBanner` | P3 顶部警告横幅 | `warnings: AssetWarning[]` |
| `EditableTextBlock` | 可编辑描述/提示词块 | `value; onSave(next); repairing: boolean` |
| `EvidenceSnippets` | 折叠证据片段列表 | `snippets: string[]; chapters?: number[]` |
| `PromptCopyBlock` | 提示词代码块+复制按钮 | `prompt; negativePrompt?; label?` |
| `ScriptSceneCard` | 剧本场景卡 | `scene: ScriptScene` |
| `DialogueLine` | 台词行 | `line: ScriptDialogueLine` |
| `FrameCard` | 分镜帧卡 | `frame: StoryboardFramePrompt` |
| `ClipCard` | 视频片段卡 | `clip: VideoClipPrompt` |
| `ScriptReviewBar` | 审核结果条 | `review: ScriptReview` |
| `TagInput` | 风格/约束标签输入 | `values; onChange; suggestions?` |

---

## 10. 现有文件修改清单

| 文件 | 修改 |
|---|---|
| `web/src/App.tsx` | BookLayout 子路由新增 `stories`、`stories/boundary-review`、`stories/:storyId/assets`、`stories/:storyId/episodes`、`director` 5 条 |
| `web/src/pages/BookLayout.tsx` | Tab 行新增「故事」（icon: `BookOpen`）与「导演」（icon: `Clapperboard`），**不加 `disabled={!isComplete}`**；「故事」Tab 显示待审边界红点徽章（数据来自 `useStories(bookId)` 的 `pendingBoundaryReviews`） |
| `web/package.json` | 新增 `"@novel-agent/story-arcs": "workspace:*"` |
| `api/src/index.ts` | 注册 `storiesRoutes`、`directorRoutes` |
| `web/src/types.ts` | 不动（故事类型独立放 `web/src/types/story.ts`，避免该文件膨胀） |

**新增文件**：

```text
web/src/types/story.ts               （§6 已给全量代码）
web/src/api/stories.ts               （hooks，示例见 §11.1）
web/src/api/director.ts
web/src/pages/story/StoriesPage.tsx           （P1，骨架见 §11.2）
web/src/pages/story/BoundaryReviewPage.tsx    （P2，核心交互见 §11.3）
web/src/pages/story/StoryAssetsPage.tsx       （P3）
web/src/pages/story/EpisodesPage.tsx          （P5）
web/src/pages/story/DirectorPage.tsx          （P4）
web/src/components/story/*                    （§9 清单）
api/src/routes/stories.ts                     （骨架见 §11.4）
api/src/routes/director.ts
api/src/services/story.service.ts
```

---

## 11. 示例代码（骨架级，接手者按此风格补全）

### 11.1 `web/src/api/stories.ts`（节选：查询 + 两个关键 mutation）

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';
import type { StorySummary, StorySegment, BoundaryReviewItem, StoryAssetPack } from '@/types/story';

export const storiesKey = { /* §7 全量 key 定义 */ };

export function useStories(bookId: string) {
  return useQuery({
    queryKey: storiesKey.list(bookId),
    queryFn: () =>
      apiFetch<{ stories: StorySummary[]; pendingBoundaryReviews: number }>(`/books/${bookId}/stories`),
    enabled: !!bookId,
  });
}

export function useStoryDetail(bookId: string, storyId: string | undefined, includeSource = false) {
  return useQuery({
    queryKey: [...storiesKey.detail(bookId, storyId ?? ''), includeSource],
    queryFn: () =>
      apiFetch<StorySegment>(`/books/${bookId}/stories/${storyId}${includeSource ? '?includeSource=true' : ''}`),
    enabled: !!bookId && !!storyId,
  });
}

export function useApproveStory(bookId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ storyId, approved }: { storyId: string; approved: boolean }) =>
      apiFetch<StorySummary>(`/books/${bookId}/stories/${storyId}/approve`, {
        method: 'POST',
        body: { approved },
      }),
    onSuccess: (_data, { storyId }) => {
      qc.invalidateQueries({ queryKey: storiesKey.list(bookId) });
      qc.invalidateQueries({ queryKey: storiesKey.detail(bookId, storyId) });
    },
  });
}

export function useResolveBoundary(bookId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ reviewId, decision }: { reviewId: string; decision: 'same_story' | 'new_story' }) =>
      apiFetch<{ item: BoundaryReviewItem; resegmented: boolean; pendingCount: number }>(
        `/books/${bookId}/stories/boundary-reviews/${reviewId}/resolve`,
        { method: 'POST', body: { decision } },
      ),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: storiesKey.boundaryReviews(bookId) });
      if (res.resegmented) qc.invalidateQueries({ queryKey: storiesKey.list(bookId) });
    },
  });
}
```

### 11.2 `web/src/pages/story/StoriesPage.tsx`（P1 骨架）

```tsx
export function StoriesPage() {
  const { bookId = '' } = useParams();
  const [sp, setSp] = useSearchParams();
  const listQ = useStories(bookId);
  const stories = listQ.data?.stories ?? [];
  const pending = listQ.data?.pendingBoundaryReviews ?? 0;
  const selectedId = sp.get('sel') ?? stories[0]?.id;
  const selected = stories.find((s) => s.id === selectedId);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">故事切分</h2>
          <p className="text-xs text-muted-foreground">
            {stories.length} 段 · {stories.filter((s) => s.approved).length} 段已审批
          </p>
        </div>
        <div className="flex gap-2">
          {pending > 0 && (
            <Button variant="outline" asChild>
              <Link to={`/books/${bookId}/stories/boundary-review`}>
                <AlertTriangle className="mr-1.5 h-4 w-4 text-yellow-500" />
                边界审核 ({pending})
              </Link>
            </Button>
          )}
          <SegmentTriggerButton bookId={bookId} hasExisting={stories.length > 0} />
        </div>
      </div>
      {stories.length === 0 && !listQ.isLoading ? (
        <SegmentEmptyState bookId={bookId} />
      ) : (
        <div className="grid h-[calc(100vh-16rem)] grid-cols-[minmax(280px,2fr)_minmax(0,3fr)] rounded-lg border bg-card">
          <div className="overflow-y-auto border-r">
            {stories.map((s) => (
              <StoryListItem key={s.id} story={s} selected={s.id === selectedId}
                onSelect={() => { sp.set('sel', s.id); setSp(sp, { replace: true }); }} />
            ))}
          </div>
          <div className="overflow-y-auto">
            {selected && <StoryDetailPanel bookId={bookId} story={selected} />}
          </div>
        </div>
      )}
    </div>
  );
}
```

### 11.3 P2 核心交互（裁决 + 快捷键 + 完成态）

```tsx
const reviewsQ = useBoundaryReviews(bookId); // status=pending
const resolveM = useResolveBoundary(bookId);
const [idx, setIdx] = useState(0);
const items = reviewsQ.data?.items ?? [];
const current = items[Math.min(idx, items.length - 1)];

const decide = (decision: 'same_story' | 'new_story') => {
  if (!current || resolveM.isPending) return;
  resolveM.mutate({ reviewId: current.id, decision }, {
    onSuccess: (res) => {
      if (res.pendingCount === 0) toast.success('边界已全部裁决，故事段已重新组装');
      // 列表因 invalidate 自动缩短，idx 保持即指向下一条
    },
  });
};

useKeyboardShortcuts({
  s: () => decide('same_story'),
  n: () => decide('new_story'),
  arrowleft: () => setIdx((i) => Math.max(0, i - 1)),
  arrowright: () => setIdx((i) => Math.min(items.length - 1, i + 1)),
}, true);
```

### 11.4 `api/src/routes/stories.ts`（后端骨架，文件直读版）

```ts
import type { FastifyInstance } from 'fastify';
import {
  listStories, getStory, approveStory, listBoundaryReviews, resolveBoundaryReview,
  startSegmentation, getSegmentationStatus, createSegmentationStream,
  getAssetPack, patchAsset, startAssetExtraction,
} from '../services/story.service.js';

export async function storiesRoutes(fastify: FastifyInstance) {
  fastify.get('/:id/stories', async (req) => {
    const { id } = req.params as { id: string };
    return listStories(id); // 读 story-segments.json + story-boundary-review.json，剥离 sourceText
  });

  fastify.post('/:id/stories/:storyId/approve', async (req, reply) => {
    const { id, storyId } = req.params as { id: string; storyId: string };
    const { approved } = req.body as { approved: boolean };
    try {
      return await approveStory(id, storyId, approved); // 校验无未决边界后改写 JSON
    } catch (e) {
      if (e instanceof UnresolvedBoundaryError) return reply.status(409).send({ error: e.message });
      return reply.status(500).send({ error: String(e) });
    }
  });

  fastify.post('/:id/stories/boundary-reviews/:reviewId/resolve', async (req, reply) => {
    const { id, reviewId } = req.params as { id: string; reviewId: string };
    const { decision } = req.body as { decision: 'same_story' | 'new_story' };
    return resolveBoundaryReview(id, reviewId, decision); // 写回 JSON；pending 清零时重组段
  });

  // POST /:id/stories/segment、GET …/segment/status、GET …/segment/stream(SSE)
  // GET/POST 资产与提示词端点 —— 全部按本设计书 §5 契约实现，SSE 写法照抄 extract.ts
}
```

### 11.5 `BookLayout.tsx` 修改（Tab 新增）

```tsx
// import { BookOpen, Clapperboard } from 'lucide-react'; 并在现有 Tab 行 <导出> 前插入：
<BookTab to={`/books/${bookId}/stories`} icon={<BookOpen className="h-4 w-4" />}>
  故事{pendingBoundaryReviews > 0 && (
    <span className="ml-1 rounded-full bg-red-500 px-1.5 text-[10px] text-white">{pendingBoundaryReviews}</span>
  )}
</BookTab>
<BookTab to={`/books/${bookId}/director`} icon={<Clapperboard className="h-4 w-4" />}>
  导演
</BookTab>
```

---

## 12. 分期实施计划

| 期 | 范围 | 验收标准 |
|---|---|---|
| **M1 只读** | API GET 端点（文件直读）+ P1 列表/详情（无审批按钮）+ P3 资产只读 + P5 全部 Tab 只读 + 路由/Tab 接入 | 对 `output/` 里已有的一次后端跑批结果，5 个页面全部能正确渲染；`pnpm --filter @novel-agent/web build` 零错误 |
| **M2 写路径** | 边界裁决（P2 全部）+ 故事审批/批量审批 + 资产描述修复（PATCH） | 裁决→重组段→列表刷新闭环可用；审批门禁（未决边界 409）在 UI 正确呈现 |
| **M3 触发与进度** | 切分触发 + 资产提取触发 + 导演任务创建（P4 全部）+ 两条 SSE 流 + 兜底轮询 | 从空书到拿到视频提示词的 §4 全流程在浏览器一次走通 |
| **M4 打磨** | 提示词单条/整包复制与 JSON 下载、原文段落跳转、批量审批 UI、键盘快捷键完善、空态/错误态统一 | 全流程无 dead-end：每个空态/错误态都有下一步动作指引 |

每期独立可合并、可演示。M1 开始前先由后端（或同一 agent）用 CLI 跑一份真实 `output/` 数据作为开发夹具。

---

## 13. 未决问题（实施时问用户）

- **Q1 bookId ↔ bookDirName 映射**：文件输出目录用可读 slug（`bookSlug(title)`），API 需要从 bookId 找到目录。方案 A：触发切分时把 dirName 写入 Prisma Book 表新字段；方案 B：`output/{dir}/meta.json` 反查。倾向 A（一次 migration，查询 O(1)），需用户确认是否允许动 schema。
- **Q2 切分是否默认带 prescanResult**：`buildStorySegments` 可选传入实体预扫结果提升人物识别。若书已完成实体提取，是否自动带上？（建议：自动带，UI 不暴露该细节。）
- **Q3 边界裁决的撤销**：本设计不支持撤销单条裁决，裁错只能重跑切分（会清空审批状态）。是否可接受？
- **Q4 重复切分的保护**：重新切分会使已审批段、资产、剧本全部失效。当前设计只做 AlertDialog 警告；是否需要归档旧结果（`output/{dir}/archive-{ts}/`）？
- **Q5 认证**：现有 API 的 JWT 对匿名请求放行（fallback anonymous），story 路由沿用同一策略即可？

---

## 14. 设计原则备忘（评审/接手时对照）

1. 阻塞的只有边界审核；其余一切（candidate 资产、thin 描述、审核警告）都是**展示 + 可修复**，绝不挡流程。
2. 列表接口永不携带 `sourceText`；原文一律懒加载。
3. 提示词类数据的 UI 铁律：**看得清、复制快、可整包导出**——它们的最终消费者是外部图像/视频工具。
4. 所有异步触发遵循「POST → SSE → GET」三段式 + 轮询兜底，与实体提取管线同构，用户心智一致。
5. 前端类型永远 `import type` 自 `@novel-agent/story-arcs`，API 扩展类型集中在 `web/src/types/story.ts`，不散落。
