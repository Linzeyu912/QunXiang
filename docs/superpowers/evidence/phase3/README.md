# 阶段三验证证据

- 计划基准日期：2026-07-19
- 上位设计：`docs/superpowers/specs/2026-07-15-cloud-library-asset-sharing-design.md` 第 5.3、7、8 节
- 阶段三计划：`docs/superpowers/plans/2026-07-19-cloud-library-phase3-sharing-copy.md`

## 实施提交

| 任务 | 提交哈希 |
| --- | --- |
| docs(plan) 阶段三实施计划 | `bf151e3` |
| D1 BookShare 模型与仓储 | `eeb9ef0` |
| D2 分享 API + 分享码校验 + 审计 | `b9be8a1` |
| F1 分享/分享给我/复制界面 | `8d6e1c2` |
| E1 复制 worker + 状态机 + 对象复用 | `5f28e56` |
| G1 完成门脚本与证据骨架 | `73d30f2` |
| review P0/P1 修复 | `afbc7b1` |
| evidence 记录 review | `204b08c` |
| E1 集成测试 fixture 修复 | `6facf19` |

## 完成门结果

- 完成门命令：`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-phase3.ps1`（在 `D:\entity` 下执行）；退出码 0
- 测试容器：`pnpm test:postgres:up` + `pnpm test:minio:up`；`postgres-test` 与 `minio-test` 均 healthy
- `pnpm db:migrate:deploy`：应用 `20260715_postgresql_baseline` / `20260719000000_phase2_objects_snapshots` / `20260719000001_phase3_book_shares` / `20260719000002_phase3_book_share_unique`；退出码 0
- 全量测试 `pnpm test`：89 个测试文件通过、519 个测试通过、0 个失败；退出码 0（覆盖阶段一/二/三 + D1 仓储 / D2 分享 / E1 复制集成）
- 全量构建 `pnpm build`：17 个 workspace 项目完成（API `tsc` 退出码 0；Web `tsc -b && vite build` 退出码 0）
- 工作区依赖检查 `pnpm check:workspace-deps`：17 个子包通过；退出码 0
- 工作区状态 `git status --short`：退出码 0（仅用户既有的未跟踪 docx/指南，与阶段三实现无关）
- 容器清理 `test:postgres:down`（`down -v` 同时清理 postgres 与 minio）；退出码 0
- 敏感信息扫描 `docs/superpowers/evidence/phase3`：无匹配；退出码 1（rg 无匹配的预期退出码）

## 已验证（不依赖 Docker）

- api / web 构建退出码 0（类型检查通过）。
- 单元测试绿：`book-share.repository.test.ts`（8）、`book-copy.test.ts`（11）；job-worker 测试未回归（11）。
- 集成测试代码已写（D2/E1 块），用 `describe.skipIf` 探测 DB，Docker 不可用时干净跳过。

## 完成门要点（设计第 13.2 / 15）

- 撤销与复制领取并发只一方成功；已撤销绝不能复制（`markCopying` 条件 active 失败 → noop）。
- 复制产生独立版本线（目标 Book/Snapshot 新建）；底层 AssetObject 复用（SnapshotObject 同 objectId，不复制字节）；引用数由关系事务正确计算。
- 删除原书不影响副本（目标书独立；`Book.sourceBookId` 仅审计）。
- 错误邮箱/分享码统一失败（恒定时间校验，不枚举注册邮箱）；正确邮箱+码定位唯一接收账号；禁止分享给自己。
- 跨账号无法访问他人分享（owner/recipient 校验，404 不泄露）。
- 创建/撤销/复制写入审计。

## 独立代码审查

后台 agent 只读审查分享/复制核心（book-copy / share.service / book-share.repository / shares 路由），发现 3 P0 + 7 P1，关键已修复（提交 `afbc7b1`）：

- P0-1 BookShare 并发创建重复 active（schema 无唯一约束）→ migration `20260719000002` 加 partial unique `(bookId, recipientId) WHERE status IN (active/copying/copied)`；`create` 捕获 P2002 回读复用。
- P0-2/P0-3 `markCopied` 在事务外（事务提交后崩溃 → share 永久 copying 死锁 + 重复目标书）→ `markCopied` 并入同一 `prisma.$transaction`；`copying` 分支事务内查重自愈（已建目标则补 markCopied，不重复创建）。
- P1-1 `create` 复用时刷新 snapshotId（发送者重新准备后不再分享旧快照）。
- P1-4 用户不存在时用 dummy `shareCodeHash` 跑一次 `verifyShareCode`，拉平时序防邮箱枚举。
- P1-6 复制失败路径补写 `BOOK_SHARE_COPY_FAILED` 审计。

已知优化项（非阻塞，标为后续）：
- P1-2 `markFailed` 缺 `recipientId` 参数（防御性；当前 worker 唯一调用且已校验接收方）。
- P1-5 `revoke` 对 `copying` 状态返回 404「分享不存在或已撤销」消息略误导（边界：复制进行中撤销）。
- P1-7 `copied` 后再向同接收方分享：`create` 复用 `copied` 行（P1-1 刷新 snapshotId 部分缓解）；后续可允许 `copied` revoke 或新建。

## 未解决事项

- 无阻塞性问题。
- 已知优化项：P1-2 / P1-5 / P1-7（见上）。
- 阶段三集成测试 + 完成门 `verify-phase3` 待 Docker daemon 恢复后运行（migrate apply 含 phase3 BookShare + partial unique → D1/D2/E1 集成 + 全量回归）。
- 阶段三未覆盖（属阶段四）：SQLite/本地文件正式迁移、公网容器化部署、两设备端到端验收。
