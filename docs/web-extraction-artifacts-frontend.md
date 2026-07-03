# 实体提取富产物前端（结构化描述 / 视觉设定 / 生成提示词）

> 实施于 2026-07-02，已对真实数据（《斗破苍穹》21 角色/11 地点/12 道具）浏览器验证。

## 背景

提取管线的后三个阶段（description-fusion → visual-description → prompt-generation）产出富数据，
但只写在时间戳运行目录 `output/{bookSlug}-{ts}/entities/` 下，数据库实体表只有扁平 `description` 字段：

| 文件 | 内容 | 关键字段 |
|---|---|---|
| `{type}-descriptions.json` | 结构化融合描述 | `fields`（外貌/服饰/体态…）、`missingFields`、`evidenceSnippets`、`sourceCoverage`、`needsReview` |
| `{type}-visual-descriptions.json` | 视觉设定（前者超集） | + `visualFields`、`visualDetails`（身形/脸型/发型/眼睛…）、`tier`、`importanceScore` |
| `{type}-prompts.json` | 生成提示词 | `prompt`（四视图设定图等）、`styleTags`、`quality`、`source` |
| `summary.md` | 运行结果概览 | — |

`{type}` ∈ character / location / item。此前这些数据前端完全不可见。

## API

`GET /books/:id/extraction-artifacts`（`api/src/routes/artifacts.ts` + `api/src/services/artifacts.service.ts`）

- 运行目录发现：扫描 `output/*/final/run-summary.json`，匹配 `bookId` 且 `officialResult !== false`，取 `generatedAt` 最新的一次。无匹配时返回 `{ available: false }`。
- 响应：`{ available, runDir, generatedAt, summaryMd, characters: { [name]: { description?, visual?, prompt? } }, locations, items }`，三层文件按实体名索引合并。
- 无缓存（目录扫描开销极小）；产物为运行级快照，前端 `staleTime: 60s`。

## 前端

- `web/src/api/artifacts.ts`：`useExtractionArtifacts(bookId)` + `matchArtifacts(data, type, name, aliases)`。
  匹配顺序：实体名精确 → 实体别名 → 产物条目别名反查（DB 与产物同源于一次运行，正常都能精确命中）。
- `web/src/components/review/EntityArtifactsSection.tsx`：三个区块，产物缺失时整节不渲染——
  1. **视觉设定**：`visualDetails`（优先）或 `visualFields` 的中文标签网格；
  2. **结构化描述**：`fields` 网格 + 证据充分度/建议复核徽章 + 缺失字段 + 证据片段（复用 story 的 `EvidenceSnippets`）；
  3. **生成提示词**：复用 `PromptCopyBlock`（一键复制）+ styleTags + 质量徽章。
- 接入点：`EntityDetailPanel`（角色/场景/道具审核页详情面板末尾）；`PipelinePage` 完成态下新增「提取结果概览」卡片（渲染 `summaryMd`）。
- 字段中文标签表在 `EntityArtifactsSection.tsx` 的 `FIELD_LABEL`，未知键回退显示原始键名（场景/道具的字段键与角色不同，遇到新键补标签即可）。

## 顺手修复

`web/vite.config.ts` 代理增加 `bypass`：SPA 路由与 API 前缀重叠（`/books/:id/characters` 既是页面又是接口），
此前 dev 模式下地址栏直达或 F5 刷新书籍页面会把 HTML 文档请求代理给 API 返回 404 JSON。
现在 `Accept: text/html` 的请求回落 `/index.html`，仅 fetch/XHR 转发给 API。

## 第二批：审核效率与导出（2026-07-02 同日）

- **实体审核页**（`EntityReviewPage.tsx` 重构）：
  - 名称/别名搜索框（前端过滤）+ 排序（置信度/提及次数/首现章节/名称）；
  - 快捷键 `A` 通过 / `R` 拒绝当前选中实体，审完自动跳下一条，支持连续键盘审核；
  - 「通过全部待审 (n)」批量按钮：作用于当前筛选+搜索下的 PENDING 实体，AlertDialog 确认后
    `Promise.allSettled` 逐条 PATCH（无后端批量端点，百级规模可接受；若未来实体数上千再加批量 API）；
  - 列表项加 ✨ 星标（`EntityListPanel` 新 `artifactIds` prop）标记拥有富产物的实体。
- **导出页**：新增「提取富产物导出」卡片——下载 `all-prompts.md`（API 端点补透出 `allPromptsMd`）
  与三类富产物全量 JSON；`downloadText` 工具加在 `PromptCopyBlock.tsx`。
- 均已在浏览器对真实数据验证（搜索"纳兰"过滤 2 条、批量按钮计数联动、21 星标、导出卡片统计正确）。

## 第三批：后端数据/流程全量可视化（2026-07-02 同日）

按用户指示「把后端的数据和流程做到前端可视化」，补齐了此前不可见的五块：

- **章节结构视图**（新「章节」Tab，`ChaptersPage.tsx`）：可视化管线第一步的真实结果。
  API `GET /books/:id/chapters` 调 `parseChapterOutline`（`import/src/pipeline.ts` 新增导出，
  只走预处理+结构化切章，不做预扫描、不写文件），带文件 mtime 内存缓存。
  展示：切章模式徽章（含 fallback 警示）、清噪行数、每章标题/字数条、叙事事件标注。
- **叙事事件**：artifacts 端点透出 `events`（events.json），章节视图按 `chapterIndex` 挂
  Badge + Tooltip（来源/置信度/跨章出现）。
- **共现角色**：角色详情新增「共现角色」chips（`Character.coCharacters`），点击跳转到该角色
  （按名/别名在当前列表查找，不在则 toast 提示）。
- **审核历史**：角色详情新增时间线（`CharacterReview` 表，`useCharacterReviews` hook 此前
  存在但从未被使用），无记录时整节隐藏。
- **运行历史**：管道页新增卡片，`GET /books/:id/extraction-runs` 列出该书全部官方运行
  （倒序，最新标「当前生效」，即 artifacts 端点采用的那次），一眼看清哪次跑成了、哪次是空跑。

浏览器实测：32 章/73,864 字/chapter_zh 模式/3 行噪声/8 处事件标注；6 次运行历史；
萧炎 → 点共现「萧薰儿」chip 详情联动切换。

## 第四批：剩余中间态与部署可用性（2026-07-02 同日）

- **噪声过滤逐行明细**：章节 Tab 新增「噪声过滤明细」折叠区，直接展示预处理报告里的
  `suspectLines`：原始行号、类别、置信度、是否实际移除。`parseChapterOutline` 的契约新增
  `removed` 字段，明确区分保守模式下 `confidence >= 0.8` 的已移除行与低置信仅标记行。
- **预扫描中间产物**：管道页新增「预扫描中间产物」卡片，API `GET /books/:id/prescan-artifacts`
  读取最新官方运行 `final/run-summary.json` 中的 `outputs.prescanIntermediate`，解析
  `.intermediate/{run}/prescan/{character,location,item,event}.txt` 与 `importance.txt`。
  前端显示四类预扫命中计数、样本行、重要性评分 Top、分层/分流统计和原文片段。
- **管线阶段补齐**：`core.AgentType`、API 阶段列表与编译链路补上 `prompt-generation`，
  管道页进度不再漏掉提示词生成阶段。
- **部署启动路径**：README 重写为新用户操作手册；`setup.bat/start.bat/start-mock.bat`
  对齐当前实际环境变量（`DATABASE_URL`、`ALLOWED_ORIGINS`）。普通启动默认保持
  LLM 未配置状态，只有显式运行 `start-mock.bat` 才启用 `LLM_PROVIDER=mock`。
  API 不再因首次无 LLM 配置直接退出，用户可先进入 Web 的 LLM 设置页完成配置。

注意：章节视图对超长书（千章级）未做虚拟滚动，行数大时可参照 `EntityListPanel` 的
`@tanstack/react-virtual` 方案补上。

## 已知限制 / 后续可做

- 产物与 DB 实体的对应基于「名字」，若审核中把实体改名，富产物区块会失配消失（重新提取即可恢复）。
- 大部头书全量 evidenceSnippets 会让响应变大（当前几十 KB 级，无碍）；超大书可改为按实体懒加载。
- `all-prompts.md` 未单独展示（内容与逐实体 prompt 重复）；如需「一键复制全部提示词」可在导出页加。
- 场景/道具的 `fields` 键位映射目前只覆盖常见键，遇到新键显示英文原名，见 `FIELD_LABEL`。
- 当前生产发布仍建议 API 以 `tsx src/index.ts` 源码方式运行；若要纯 `node dist/index.js`
  发布，需要先补 workspace 包构建或 API bundling。
