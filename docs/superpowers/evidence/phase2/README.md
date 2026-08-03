# 阶段二验证证据

- 计划基准日期：2026-07-19
- 上位设计：`docs/superpowers/specs/2026-07-15-cloud-library-asset-sharing-design.md`
- 阶段二规格：`docs/superpowers/specs/2026-07-16-cloud-library-phase2-snapshots-downloads-design.md`
- 阶段二计划：`docs/superpowers/plans/2026-07-15-cloud-library-phase2-snapshots-downloads.md`

## 实施提交

| 任务 | 提交哈希 |
| --- | --- |
| docs(plan) 阶段二实施计划 | `531d574` |
| A1 对象存储抽象与 FsObjectStore | `6f99abc` |
| A2 S3 兼容对象存储与 MinIO 测试环境 | `e7917ba` |
| A3 不可变对象与快照数据模型及仓储 | `d97be25` |
| A4 原书对象化与 AssetSourceResolver | `2373133` |
| A5 实体图片对象化 | `45bda0a` |
| B1 确定性 contentRevision 与运行发现 | `a0e9e2d` |
| B2 manifest 合同与脱敏 golden 样本 | `36d4a9e` |
| B3 确定性 ZIP 打包 | `c5578d0` |
| C2 云端书库下载状态界面（前端） | `fa04513` |
| 完成门脚本与证据骨架 | `ad7c967` |
| B4 collector + B5 worker + C1 下载授权 API | `2b29edd` |
| 对象存储配置示例 | `64320af` |

## 完成门结果

- 完成门命令：`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-phase2.ps1`；退出码 0
- 测试容器：`pnpm test:postgres:up` + `pnpm test:minio:up`；`postgres-test` 与 `minio-test` 均 healthy
- PostgreSQL baseline + 阶段二 migration：`pnpm db:migrate:deploy` 应用 `20260715_postgresql_baseline` 与 `20260719000000_phase2_objects_snapshots`；退出码 0
- 全量测试：`pnpm test`；85 个测试文件通过、482 个测试通过、0 个失败；退出码 0
- 全量构建：`pnpm build`；17 个 workspace 项目完成（API `tsc` 退出码 0，Web `tsc -b && vite build` 退出码 0）
- 工作区依赖检查：`pnpm check:workspace-deps`；17 个子包通过；退出码 0
- 工作区状态：`git status --short`；退出码 0（仅含用户既有的未跟踪 docx/指南，与阶段二实现无关）
- 数据库与对象存储清理：`pnpm test:postgres:down`（`down -v` 同时清理 postgres 与 minio 容器及卷）；退出码 0
- 敏感信息扫描：`docs/superpowers/evidence/phase2` 无匹配；退出码 1（rg 无匹配时的预期退出码）

## 完成门要点（设计第 12.3）

- 同一快照重复打包：manifest、各文件 sha256、ZIP 整体哈希一致——由 `manifest.test.ts`、`zip.test.ts` 的确定性单测与 golden fixture 覆盖。
- 跨账号查询/下载快照被拒（统一中文 404）——由 `snapshots.integration.test.ts` 的 owner 矩阵覆盖。
- 签名过期重新授权返回同一 ETag；Range 内容与完整对象一致——由 FsObjectStore 的 token/range 单测与 object-download 路由集成测试覆盖。
- golden manifest 与完整 ZIP SHA-256 通过——由 `manifest.test.ts` golden fixture 覆盖。
- MinIO 容器与测试 bucket 在验证后清理——`down -v`。

## 实现说明

- 对象存储 Fs + S3 双实现，业务代码只依赖 `ObjectStore` 接口；本地开发用 Fs 免 Docker，集成测试用 MinIO 验证真实签名/Range。
- 对象键内容寻址（`obj/{sha256[:2]}/{sha256[2:4]}/{sha256}`）跨书去重；引用数由 `SnapshotObject` + manifest/archive 关系事务计算，不用裸计数器。
- 原书与实体图片写入直接对象化；提取/故事/导演产物在快照发布时由 collector 收集为不可变 `AssetObject`；旧 `filePath` 经 `AssetSourceResolver` 只读回退；不双写。
- 快照状态机 `building → ready（写 manifestObjectId）→ ready（写 archiveObjectId）`；worker 完成 asset-snapshot 后置 `Book.currentSnapshotId`，供 `getDownloadState`/签名下载定位。
- 确定性 `contentRevision` 由结构化数据更新时间、最新稳定运行、实体集合哈希、噪声覆盖哈希、故事产物哈希计算，不使用当前时间或本机路径。
- 访问令牌仅前端内存；签名下载 URL 不入数据库/日志/查询缓存；对象键不进前端响应。

## 独立代码审查

后台 agent 对 collector / snapshot.service / job-worker / snapshots / object-download / 对象存储 / 仓储做只读审查，发现 2 个 P0 + 10 个 P1，已全部处理（提交 `efbd960`）：

- P0-1 `setCurrentSnapshot` 经 Prisma `update` 触发 `@updatedAt`，使 `contentRevision` 含的 `bookUpdatedAt` 漂移 → 永远 needs-update 死循环。改用原生 SQL `UPDATE ... SET "currentSnapshotId"`，不刷新 updatedAt。回归测试覆盖（`book.repository.test.ts` setCurrentSnapshot 不变 updatedAt）。
- P0-2 失败快照因 `(bookId,contentRevision)` 唯一约束卡死，无法重建 → `findByBookAndContentRevision` 不再过滤 failed；`prepareSnapshot` 命中 failed 时先 `deleteById` 再 create。
- P1-1/2/3 `Location`/`Item`（importanceScore 平分）、`Review`（createdAt 同毫秒）、`EntityImage.findByBookId`（无 orderBy）排序非确定 → 全部补次级 `{ id: 'asc' }`，确保 manifest/contentRevision 确定性。
- P1-4 `getDownloadState` 在 `archiveObjectId` 缺失时误报 ready → 改返回 preparing，与 `authorizeDownload` 的 409 判定一致。
- P1-5 `recoverExpired` 仅启动时跑一次 → worker 周期（30s）回收过期租约。
- P1-6 S3 越界 Range 的 `Content-Range`/`Content-Length` 用请求值 → clamp 到 `total-1`。
- P1-7 `prepareSnapshot` 并发竞态撞唯一约束 → 捕获“已存在快照”后复用现有。
- P1-8 `snapshot-archive` 永久失败后无法重投 → `enqueue` 加 `reactivate` 选项，归档投递时重置 failed→pending。
- P1-9 `getSnapshotSummary`/`authorizeDownload` 未校验 `snapshot.bookId === book.id` → 补校验，防同账号跨书契约绕过。
- P1-10 `markReady` 与 `setCurrentSnapshot` 之间进程崩溃的窗口：接受（重跑可恢复、窗口小），后续可合并为单事务。

## 未解决事项

- 无阻塞性问题。
- 已知小窗口（P1-10）：`markReady` 后 `setCurrentSnapshot` 前崩溃，依赖租约过期重跑恢复；后续可合并为单事务。
- 阶段二未覆盖（按计划属阶段三/四）：账号间分享复制状态机、SQLite/本地文件正式迁移、公网容器化部署与两设备端到端验收。
