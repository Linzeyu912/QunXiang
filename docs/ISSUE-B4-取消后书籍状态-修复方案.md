# ISSUE-B4 修复方案：边界取消后书籍状态停留 EXTRACTING

> 日期：2026-08-29
> 状态：待产品决策（二选一后即可实施，改动约 30 行 + 2 个测试）
> 关联：KNOWN_ISSUES.md「ISSUE-B4」

## 1. 现象与根因

取消提取运行有两条代码路径，对 `Book.status` 的处理不一致：

| 路径 | 代码位置 | 行为 |
|---|---|---|
| ① 已暂停后取消 | `api/src/services/extraction-run.service.ts` `cancelRun` PAUSED 分支（约 238-248 行） | `markCancelled` + 清理 pending 任务 + **`Book.status → UPLOADED`** |
| ② 运行中取消（边界取消） | `scheduler/src/dispatcher.ts` `checkRunControl` 返回 `'cancel'`（约 760-763 行）→ `processTask` 取消分支（约 485-489 行） | 只 `markCancelled` 收敛会话，**不更新 `Book.status`**，书永久停留 `EXTRACTING` |

## 2. 实际影响（比「显示不一致」更严重）

重新触发提取的门槛是 **pending/running 任务**（`startExtraction` 只查 Task 表，不查 Book.status），
所以边界取消后从管道页「重新提取」仍然可用。**但书库页被真实阻塞**：

- `web/src/pages/LibraryPage.tsx` 行 158：`isRunning = book.status === 'EXTRACTING'`
- 行 222：「开始提取」按钮 `disabled={isRunning || …}` → **永久禁用**，且一直显示「进行中」转圈
- 行 254：「删除」按钮 `disabled={isRunning}` → **永久禁用**

即：用户在书库页看到一本永远在「提取中」的书，不能重新开始、不能删除，只能进管道页操作。
这不是纯显示问题，是功能阻塞。

## 3. 待决策点：取消后书籍应显示什么状态

关键事实：边界取消时「未发布候选结果，最近稳定结果保持不变」（dispatcher 行 486-488）。
因此书可能已经有上一轮已发布的稳定结果（`currentExtractionSessionId` 非空）。

### 方案 A：一律置 `UPLOADED`（与 PAUSED 路径对齐）

- 优点：改动最小，两条路径天然一致；书库按钮恢复可点，语义为「回到可重新提取」。
- 缺点：若是「重新提取」被取消，书其实还有上一轮的完整结果，却显示「待提取」，
  审核/导出 Tab 数据仍在，状态文案与数据可用性不符。

### 方案 B（推荐）：按是否有稳定结果分流

- `currentExtractionSessionId` 非空（有已发布结果）→ 置 `EXTRACTED`
- 否则（首次提取就被取消）→ 置 `UPLOADED`
- 优点：状态与数据可用性一致——有结果就显示「已提取」，没有就显示「待提取」；
  书库页按钮行为也随之正确（有结果的书本来就被禁止在列表重复触发）。
- 缺点：多一个查询判断；两条取消路径要共用这个规则，改动略大。

## 4. 实施清单（以方案 B 为例，方案 A 为其子集）

1. `storage` 或 `api` 侧新增小函数，如 `BookRepository.settleStatusAfterCancel(bookId)`：
   读 `currentExtractionSessionId`，非空置 `EXTRACTED`，空置 `UPLOADED`。
2. `scheduler/src/dispatcher.ts` 边界取消分支（`processTask` 行 485-489）调用该函数。
   （注意 dispatcher 在 scheduler 包，需确认它能访问同一 Prisma 客户端——`finalizePipeline`
   已在用 `BookRepository.updateStatus`，同包引用即可。）
3. `api/src/services/extraction-run.service.ts` PAUSED 取消分支（行 246）改为调用同一函数，
   两条路径彻底对齐。
4. 测试：
   - 边界取消：有/无稳定结果各一例，断言 Book.status 分流正确；
   - PAUSED 取消：有稳定结果的书取消后应为 `EXTRACTED`（现行为是 `UPLOADED`，属行为修正）。
5. 前端：**无需改动**——`BookStatusBadge`、LibraryPage、BookLayout 对两种状态已有完整覆盖。

## 5. 风险与边界

- 取消分支目前不清理该书残留的 pending 任务（PAUSED 路径会清）。边界取消发生在
  「当前任务已完成、下一阶段未入队」的时点，正常无残留；若续跑排过队则可能有。
  建议与状态修正一并补一行 `task.updateMany(cancelled)`，与 PAUSED 路径对称。
- 并发：取消收敛与 finalizeRun/finalizePipeline 不会同时发生（同书单管线串行），无竞态。
- 若选方案 A，则第 1 步退化为固定置 `UPLOADED`，第 3 步不变，测试减半。
