# 云端书库阶段二：对象存储、成果快照与完整下载 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: 用 TDD 逐任务实现（先写失败测试→确认失败→最小实现→定向测试+构建→独立提交）。步骤用 `- [ ]` 复选框跟踪。

**Goal:** 让"云端资产身份"脱离服务器本机绝对路径；处理稳定的书籍可按需发布不可变、版本化、可校验的完整成果快照；同一快照重复生成 manifest/ZIP 字节一致；所有者可查看数据包状态并获取短时签名下载；签名过期可对同一 ETag/版本续传；跨账号严格隔离；旧本地文件在阶段四迁移前仍只读可用。

**Architecture:** `ObjectStore` 接口抽象下提供 `FsObjectStore`（本地默认，免 Docker）与 `S3ObjectStore`（MinIO 测试 + 正式）。原书、实体图片的**写入路径**直接对象化；提取/故事/导演产物在**快照发布时**由 `AssetSourceResolver` 从磁盘临时区收集为不可变 `AssetObject`（内容寻址对象键，去重）。`AssetSnapshot` + `SnapshotObject` 表达版本化快照与对象引用关系（引用数由关系表事务计算，不用裸计数器）。复用阶段一 `BackgroundJobRepository` 跑两种后台任务（`asset-snapshot` 收集清单、`snapshot-archive` 生成确定性 ZIP），新增 worker 轮询守护进程。下载经所有权校验后返回短时签名地址 + ETag/版本，支持 Range 续传。

**Tech Stack:** TypeScript ESM、Fastify 4、Prisma 5、PostgreSQL 15、@aws-sdk/client-s3（S3 兼容）、MinIO（测试）、archiver（确定性 ZIP）、React 18 + Zustand + @tanstack/react-query、Vitest、Docker Compose。

## 上游与基线

- 上位设计：`docs/superpowers/specs/2026-07-15-cloud-library-asset-sharing-design.md`（用户桌面"云端书库-账号资产与分享复制完整设计.docx"）
- 阶段二规格（讨论稿）：`docs/superpowers/specs/2026-07-16-cloud-library-phase2-snapshots-downloads-design.md`
- 路线：`docs/superpowers/plans/2026-07-15-cloud-library-roadmap.md`
- 阶段一已完成（账号、PostgreSQL baseline、刷新会话、`BackgroundJob` 租约、所有权下推、`AuditLog`；338 测试全绿；证据 `docs/superpowers/evidence/phase1/README.md`）
- 所有权决策：`docs/superpowers/decisions/0001-retain-book-user-id-as-owner-column.md`（`Book` 保留 `userId` 物理列；**新模型必须用 `ownerId`**）

## Global Constraints（继承阶段一 + 阶段二特定）

- 所有用户可见 UI 文案、错误信息和新增日志必须中文。
- 正式库只允许 `prisma migrate deploy/status`，**禁止 `db push`**；新模型走新 migration 文件。
- 访问令牌只在前端内存；**签名下载 URL 不写入数据库、日志、查询缓存**；签名参数与对象键不进前端错误。
- **不做本地文件与对象存储双写**；新原书/图片直接写对象存储，旧 `filePath` 仅只读回退。
- 对象去重靠 `AssetObject(sha256, bytes)` 唯一；对象键内容寻址；ZIP 内逻辑路径在 `SnapshotObject.logicalPath` 层表达。
- 新模型（`AssetObject`/`AssetSnapshot`/`SnapshotObject`）用 `ownerId` 语义；快照权限按 `snapshot.ownerId` 校验。
- 每个任务先写失败测试，完成最小实现后运行定向测试 + 构建，再独立提交；提交信息含 `Constraint`/`Confidence`/`Scope-risk`，存在否决方案加 `Rejected`，未跑某项验证加 `Not-tested`。
- ESM 包内导入一律带 `.js` 扩展名（即便源是 `.ts`）；仓储走 `create*Repository(db)` 工厂 + `prisma` 单例；路由走 `buildApp()` 注册；错误走 `sendServerError`/`sendBookNotFound`。
- 测试 MinIO 加入 `docker-compose.test.yml`，`scripts/test-runner.mjs` 注入配置；测试隔离靠每次 `migrate reset` + `beforeEach deleteMany`。

## 关键边界决策（阶段二去路径化范围）

设计文档第 5.2 节明确"上传、图片、故事和导演写入**逐步**改为先生成临时内容再写对象存储，按产物类型拆任务，避免一次重写所有生产流程"。据此阶段二边界：

| 产物 | 阶段二处理 | 说明 |
| --- | --- | --- |
| 原书 TXT（新上传） | **写入路径对象化**（A4） | 直接写 `ObjectStore` + DB `objectKey`，旧 `filePath` 只读回退 |
| 实体图片（新生成/上传） | **写入路径对象化**（A5） | `persistImage` 改写对象存储，旧图 `filePath` 只读回退 |
| 提取/故事/导演文件型产物 | **快照层对象化**（B4 收集） | 生产写入仍落磁盘 `output/` 临时区；快照发布时经 `AssetSourceResolver` 收集为不可变 `AssetObject`。云端身份与下载完全不依赖本机路径 |
| 章节清洗内容 | **快照时物化**（B4） | 现状从 `Book.filePath` 实时计算；快照收集时计算并写入对象存储（仅快照内） |

结果：所有**云端资产身份、快照、下载、（阶段三）分享**都基于对象键，不再依赖 Windows 绝对路径；提取/故事/导演的**生成期**临时文件保留磁盘至阶段四迁移。这与设计"逐步改造、兼容过渡"一致，且把工作量控制在可分批验证的规模。

## File Structure

### 新增文件

- `storage/src/object-storage/types.ts`：`ObjectStore` 接口与输入/输出类型（`PutObjectInput`/`StoredObject`/`ObjectMetadata`/`ObjectBody`/`ByteRange`/`SignedDownloadInput`/`SignedDownload`）。
- `storage/src/object-storage/object-key.ts`：内容寻址对象键构造与路径安全校验（拒绝绝对路径/盘符/反斜杠/`.`/`..`/NUL）。
- `storage/src/object-storage/fs-object-store.ts`：`FsObjectStore`（对象键→`storage/objects/{key}`；签名下载为内部 HMAC 短时 token）。
- `storage/src/object-storage/s3-object-store.ts`：`S3ObjectStore`（@aws-sdk/client-s3 + presigned）。
- `storage/src/object-storage/index.ts`：`createObjectStoreFromEnv()` 工厂（按 `OBJECT_STORAGE_PROVIDER` 选 `fs`/`s3`）。
- `storage/src/object-storage/*.test.ts`：对象键安全、Fs put/head/get(range)/delete、HMAC 签名验证。
- `storage/src/object-storage/s3.integration.test.ts`：MinIO put/head/get(range)/delete/presign。
- `storage/src/asset-object.repository.ts`、`asset-snapshot.repository.ts`、`snapshot-object.repository.ts`：三模型仓储（factory + 单例）。
- `storage/src/asset-source-resolver.ts`：`AssetSourceResolver`（有 `AssetObject` 走对象存储；旧 `filePath` 只读本机；禁止任意绝对路径回退）。
- `api/src/config/storage.ts`：`getObjectStorageConfig()` 读 `OBJECT_STORAGE_*`。
- `api/src/lib/content-revision.ts`：确定性 `computeContentRevision()` 纯函数 + 单元测试。
- `api/src/lib/manifest.ts`：manifest 合同、稳定 JSON 序列化、确定性 ZIP 打包（archiver 固定参数）+ 单元测试。
- `api/src/lib/zip-deterministic.test.ts`：重复打包字节一致、路径安全、SHA-256。
- `api/src/snapshot/manifest-fixture/`：脱敏 golden fixture（虚构短文 + 虚构实体 + 小图片字节）+ `golden-manifest.json` + 期望哈希（**不提交生成的 ZIP**）。
- `api/src/snapshot/collector.ts`：快照收集器（读取各类产物 → 写 `AssetObject` 去重 → 写 `SnapshotObject`）。
- `api/src/snapshot/run-discovery.ts`：`discoverCurrentRun(bookId)`（扫描 `output/` 读 `run-summary.json`，按 `bookId` + `officialResult !== false` 取最新 `generatedAt`，返回 `runDir`）。
- `api/src/services/job-worker.service.ts`：后台任务 worker 轮询守护（仿 `TaskDispatcher.startWorker`），从 `app.ts` 启动；处理 `asset-snapshot`/`snapshot-archive`。
- `api/src/services/snapshot.service.ts`：快照业务编排（创建/复用任务、查询状态、签名授权、ETag/Range 续传判定）。
- `api/src/routes/snapshots.ts`：`GET /books/:id/download-state`、`POST /books/:id/snapshots`、`GET /books/:id/snapshots/:snapshotId`、`POST /books/:id/snapshots/:snapshotId/download-authorizations`。
- `api/src/routes/object-download.ts`：内部签名下载端点（验证 Fs HMAC token，流式 + Range）。
- `web/src/api/downloads.ts`：`downloadStateKey` + `useBookDownloadState`/`usePrepareDownload`/`useRequestDownloadUrl`（仿 `books.ts`，`refetchInterval` 按状态）。
- `web/src/components/DownloadStateBadge.tsx`：5 态徽标（仿 `StatusBadge.tsx`）。
- `scripts/verify-phase2.ps1`：阶段二完成门脚本（仿 `verify-phase1.ps1`，含 MinIO up/down）。
- `docs/superpowers/evidence/phase2/README.md`：脱敏验证证据。

### 重点修改文件

- `storage/prisma/schema.prisma`：新增 `AssetObject`/`AssetSnapshot`/`SnapshotObject`；`Book.currentSnapshotId` +关系到 `AssetSnapshot`（onDelete: SetNull）；`Book.sourceObjectKey?`/`EntityImage.objectKey?`（可空，兼容期与 `filePath` 并存）。
- `storage/prisma/migrations/{ts}_phase2_objects_snapshots/migration.sql`：由 `prisma migrate diff` 生成 + 追加 CHECK 约束（`AssetSnapshot.status IN ('building','ready','failed')`）。
- `storage/src/index.ts`：再导出对象存储与三个新仓储。
- `core/src/index.ts` + `core/src/snapshot.ts`：快照/对象公共类型与输入类型。
- `api/src/app.ts`：注册 `snapshots`/`object-download` 路由；启动 `job-worker`；注入 `ObjectStore` 单例。
- `api/src/routes/books.ts`：上传 POST 改为对象存储写入（A4）。
- `api/src/services/image-generation.service.ts`：`persistImage` 改对象存储写入（A5）；`readImageRaw` 经 `AssetSourceResolver`。
- `api/src/routes/images.ts`：图片读取经 `AssetSourceResolver`。
- `api/src/routes/ownership.integration.test.ts`：新端点加入 `it.each` 矩阵。
- `docker-compose.test.yml`：加 `minio-test` 服务（9000/9001）。
- `scripts/test-runner.mjs`：`childEnv` 注入 MinIO 配置；新增 `test:minio:up`/`test:minio:down`（根 `package.json`）。
- `api/.env.example` / `.env`：加 `OBJECT_STORAGE_*`。
- `web/src/types.ts`：加 `DownloadState` + `BookDownloadState`。
- `web/src/pages/LibraryPage.tsx`：`BookRow` 集成 `DownloadStateBadge` + 动作 + 准备中进度条。

---

## 批次 A：资产对象化基础

### Task A1：对象存储接口、对象键安全与 FsObjectStore

**Files:** 见"新增文件"对象存储部分（types/object-key/fs-object-store/index + 测试）、`api/src/config/storage.ts`、`storage/src/index.ts`。

**Interfaces:**
- `ObjectStore { put(input): Promise<StoredObject>; head(objectKey): Promise<ObjectMetadata|null>; get(objectKey, range?): Promise<ObjectBody>; delete(objectKey): Promise<void>; createDownloadUrl(input): Promise<SignedDownload> }`
- 对象键：`obj/{sha256[0:2]}/{sha256[2:4]}/{sha256}` + 扩展名；`assertSafeObjectKey()` 拒绝非法段。
- `FsObjectStore.put` 计算 sha256/bytes/mime，写入 `storage/objects/{key}`（原子 tmp→rename），已存在（同 sha256）则 head 复用不覆盖；`createDownloadUrl` 返回 `{ url: '/objects/dl?token=<hmac>', expiresAt, etag: sha256 }`，token = HMAC-SHA256(secret, `{key}|{exp}`)。

- [ ] **Step 1：写失败测试** — `object-key.test.ts`（非法键全被拒）、`fs-object-store.test.ts`（put 返回 sha256/bytes/mime；同内容二次 put 复用不覆盖；head/get/range；delete；签名 token 过期/篡改被拒）。
- [ ] **Step 2：确认失败** — `pnpm exec vitest run storage/src/object-storage/`。
- [ ] **Step 3：实现** — 接口、对象键工具、`FsObjectStore`、`createObjectStoreFromEnv`、`config/storage.ts`（缺 secret 时中文中止）。`storage/src/index.ts` 再导出。
- [ ] **Step 4：定向测试 + 构建** — vitest 通过；`pnpm --filter @qunxiang/storage build`（如适用）/ `pnpm --filter @qunxiang/api build` 退出码 0。
- [ ] **Step 5：提交** — `feat(storage): 加入对象存储抽象与本地文件系统实现` / Constraint: 业务代码只依赖 ObjectStore 接口 / Confidence: high / Scope-risk: moderate。

### Task A2：S3ObjectStore + MinIO 测试环境

**Files:** `s3-object-store.ts` + 集成测试、`docker-compose.test.yml`、`scripts/test-runner.mjs`、根 `package.json`（`test:minio:up/down`）。

**Interfaces:** `S3ObjectStore` 用 `@aws-sdk/client-s3`（`PutObject`/`HeadObject`/`GetObject` 带 `Range`/`DeleteObject`）+ `getSignedUrl`（presign，TTL 来自配置）。`head` 返回 etag/versionId/contentLength。

- [ ] **Step 1：写失败测试** — `s3.integration.test.ts`（put→head→get 全文→get Range 区间字节一致→delete→presign URL 可 GET）。测试通过 `test:minio:up` 起的 MinIO 跑；缺 MinIO 时 skip 并中文标注。
- [ ] **Step 2：确认失败** — `pnpm test -- storage/src/object-storage/s3.integration.test.ts`。
- [ ] **Step 3：实现 + 接 MinIO** — `docker-compose.test.yml` 加 `minio-test`（`minio/minio`，9000/9001，env `MINIO_ROOT_USER/PASSWORD`，healthcheck）；`test-runner.mjs` 的 `childEnv` 注入 `OBJECT_STORAGE_PROVIDER=s3` + endpoint/bucket/creds（测试默认值），并保证 `test:postgres:up` 同时拉起 minio（或新增 `test:minio:up` 并在编排里调用）；`test:minio:down` 清理。装 `@aws-sdk/client-s3`、`@aws-sdk/s3-request-presigner` 依赖（api 或 storage workspace）。
- [ ] **Step 4：定向测试** — MinIO 集成测试通过。
- [ ] **Step 5：提交** — `feat(storage): 加入 S3 兼容对象存储与 MinIO 测试环境` / Constraint: 业务代码不绑厂商扩展 / Confidence: high / Scope-risk: moderate。

### Task A3：AssetObject/AssetSnapshot/SnapshotObject 模型与仓储

**Files:** `schema.prisma`、新 migration、三个仓储 + 测试、`core/src/snapshot.ts`、`storage/src/index.ts`、`postgresql-baseline.integration.test.ts`（加断言）。

**Interfaces（Prisma 模型，新表用 `ownerId`）：**
```prisma
model AssetObject {
  id        String   @id @default(uuid()) @db.Uuid
  sha256    String
  bytes     BigInt
  mime      String
  objectKey String   @unique
  etag      String?
  versionId String?
  createdAt DateTime @default(now()) @db.Timestamptz(3)
  snapshots SnapshotObject[]
  @@unique([sha256, bytes])
}
model AssetSnapshot {
  id              String    @id @default(uuid()) @db.Uuid
  bookId          String    @db.Uuid
  book            Book      @relation(fields: [bookId], references: [id], onDelete: Cascade)
  ownerId         String    @db.Uuid
  version         Int
  contentRevision String
  status          String    @default("building") // building|ready|failed
  manifestObjectId String?  @db.Uuid
  archiveObjectId String?   @db.Uuid
  failureReason   String?
  createdAt       DateTime  @default(now()) @db.Timestamptz(3)
  readyAt         DateTime? @db.Timestamptz(3)
  objects         SnapshotObject[]
  @@unique([bookId, version])
  @@unique([bookId, contentRevision], map: "AssetSnapshot_book_content_revision")
  @@index([bookId, status])
}
model SnapshotObject {
  id          String @id @default(uuid()) @db.Uuid
  snapshotId  String @db.Uuid
  snapshot    AssetSnapshot @relation(fields: [snapshotId], references: [id], onDelete: Cascade)
  objectId    String @db.Uuid
  object      AssetObject @relation(fields: [objectId], references: [id], onDelete: Restrict)
  logicalPath String
  category    String   // source|entity|review|chapter|extraction|story|image|manifest|archive
  state       String   // present|empty|not-generated
  reason      String?
  @@unique([snapshotId, logicalPath])
  @@index([objectId])
}
```
`Book.currentSnapshotId String? @db.Uuid` + `currentSnapshot AssetSnapshot? @relation("BookCurrentSnapshot", fields: [currentSnapshotId], references: [id], onDelete: SetNull)`；`Book.sourceObjectKey String?`、`EntityImage.objectKey String?`（可空）。

**仓储关键方法：**
- `AssetObjectRepository.putIfAbsent({ sha256, bytes, mime, objectKey, etag?, versionId? })`：`upsert` by `objectKey`，冲突/同 sha256 复用，返回现有或新建行。
- `SnapshotObjectRepository.bulkCreate(snapshotId, items[])`：事务内插入并保证 `(snapshotId, logicalPath)` 唯一。
- `AssetSnapshotRepository`：`create({ bookId, ownerId, contentRevision })`（version = 该 book 已有 max+1；`(bookId,contentRevision)` 非失败唯一由 DB 保证，冲突抛中文）；`markReady(id, manifestObjectId)`、`markArchive(id, archiveObjectId)`、`markFailed(id, reason)`（均条件更新 `building`）；`findOwnedById(id, ownerId)`、`findCurrentForBook(bookId, ownerId)`。
- 对象引用计数：`countReferences(objectId)` = `snapshotObject.count({ where: { objectId } })`；`deleteIfUnreferenced(objectId)` 事务判定。

- [ ] **Step 1：写失败测试** — 三仓储测试（putIfAbsent 去重、bulkCreate 唯一路径、create contentRevision 冲突、状态机条件更新、引用计数、owner 校验）；`postgresql-baseline` 加新表/索引/`AssetSnapshot_status_check` 断言。
- [ ] **Step 2：确认失败** — `pnpm test -- storage/src/asset-object.repository.test.ts storage/src/asset-snapshot.repository.test.ts storage/src/snapshot-object.repository.test.ts storage/src/postgresql-baseline.integration.test.ts`。
- [ ] **Step 3：改 schema + 生成 migration** — 完成模型 → `prisma migrate diff --from-schema-datasource ... --to-schema-datamodel ./prisma/schema.prisma --script > migrations/{ts}_phase2_objects_snapshots/migration.sql` → 追加一次 `AssetSnapshot_status_check` CHECK。实现三仓储 + core 类型 + 再导出。
- [ ] **Step 4：定向测试** — 全部通过，含 schema 断言。
- [ ] **Step 5：提交** — `feat(storage): 加入不可变对象与快照数据模型` / Constraint: 对象去重靠 sha256+bytes；引用数事务计算 / Rejected: 裸引用计数器（会漂移） / Confidence: high / Scope-risk: broad。

### Task A4：原书对象化 + AssetSourceResolver（旧 filePath 只读回退）

**Files:** `asset-source-resolver.ts`+测试、`api/src/routes/books.ts`（上传）、`storage/src/book.repository.ts`、`storage/prisma/schema.prisma`（`Book.sourceObjectKey`）。

**Interfaces:**
- `AssetSourceResolver.readSource(book)`：有 `sourceObjectKey` → `ObjectStore.get`；否则旧 `filePath` 本机只读；**禁止**接受调用方传入的任意路径。
- 上传 POST：写 `ObjectStore.put`（mime text/plain）→ `BookRepository.create({ ..., sourceObjectKey, filePath: null }）`；旧书 `filePath` 仍可读。
- 原书字节用于 manifest 的 `source/原始书籍.txt` 与章节清洗。

- [ ] **Step 1：写失败测试** — resolver（对象优先、旧路径回退、拒绝任意路径）；上传集成测试（新书 DB 不存绝对路径，存 `sourceObjectKey`；旧书仍可读取正文）。
- [ ] **Step 2：确认失败**。
- [ ] **Step 3：实现** — resolver、上传改造、`Book.sourceObjectKey`。`readBookSourceText` 统一入口供 artifacts/snapshot 复用。
- [ ] **Step 4：定向测试 + 全量回归 + 构建** — 含 `ownership.integration.test.ts`、`books` 路由、extraction empty-result。
- [ ] **Step 5：提交** — `feat(books): 原书对象化并保留旧文件只读回退` / Constraint: 不双写；新代码不把绝对路径当云端身份 / Confidence: high / Scope-risk: moderate。

### Task A5：实体图片对象化

**Files:** `api/src/services/image-generation.service.ts`（`persistImage`/`readImageRaw`）、`api/src/routes/images.ts`、`EntityImage.objectKey`。

**Interfaces:** `persistImage` 生成/上传字节先写 `ObjectStore.put` → `EntityImageRepository.create({ ..., objectKey, filePath: 旧值保留兼容 })`；读取经 `AssetSourceResolver.readImage(image)`（objectKey 优先，filePath 回退）。图片仍按 `{bookId}/{type}/{fileUuid}` 逻辑命名（gallery 跨 run 稳定），底层对象键内容寻址去重。

- [ ] **Step 1：写失败测试** — 新生成/上传图片 DB 存 `objectKey`、可经对象存储读回同字节；旧图 `filePath` 回退可读；读取拒绝任意路径。
- [ ] **Step 2：确认失败**。
- [ ] **Step 3：实现** — `persistImage`/`readImageRaw`/images 路由改造。
- [ ] **Step 4：定向测试 + 构建**。
- [ ] **Step 5：提交** — `feat(images): 实体图片对象化并保留旧文件只读回退` / Confidence: high / Scope-risk: moderate。

---

## 批次 B：快照、manifest 与确定性 ZIP

### Task B1：确定性 contentRevision + 当前 run 发现

**Files:** `api/src/lib/content-revision.ts`+测试、`api/src/snapshot/run-discovery.ts`+测试。

**Interfaces:**
- `discoverCurrentRun(bookId)`：`readdir('output')` 读每个 `final/run-summary.json`，过滤 `summary.bookId === bookId && officialResult !== false`，取最大 `generatedAt`，返回 `{ runDir, generatedAt } | null`。
- `computeContentRevision({ bookUpdatedAt, run, entityObjectHashes, noiseOverrideHash, storyHashes })`：`sha256(stableStringify({ ...按固定键序排序 }))`。**禁止 `Date.now()`**。输入包含：`book.updatedAt`、最新稳定 `run.runDir + generatedAt`、三类实体 DB 行稳定哈希、`NoiseOverride` 集合哈希、故事产物存在性 + 关键文件哈希（`story-segments.json`、各 story `asset-pack.json`/`script-episodes.json`）。
- 性质：成果不变→稳定；任一输入变→变化；LF/CRLF、本机路径不影响逻辑哈希（按内容）。

- [ ] **Step 1：写失败测试** — 相同输入→同 revision；改任一输入→变；无 run 时仍可计算（run=null）；`discoverCurrentRun` 多 run 取最新、过滤 `officialResult===false`。
- [ ] **Step 2：确认失败**。
- [ ] **Step 3：实现**。
- [ ] **Step 4：定向测试**。
- [ ] **Step 5：提交** — `feat(snapshot): 确定性成果版本号与当前运行发现` / Constraint: 不用当前时间或本机路径 / Confidence: high / Scope-risk: moderate。

### Task B2：manifest 合同 + golden fixture

**Files:** `api/src/lib/manifest.ts`+测试、`api/src/snapshot/manifest-fixture/`（虚构短文 + 虚构三类实体 + 小图片字节 + `golden-manifest.json` + 期望 SHA-256）。

**合同（设计文档第 7.2–7.4）：**
- 固定 ZIP 目录（`manifest.json` / `source/` / `entities/{characters,locations,items}.json` / `reviews/{current,history}.json` / `chapters/{outline.json, cleaned/}` / `noise/overrides.json` / `extraction/latest/{run-summary.json, prescan/, artifacts/}` / `stories/{story-segments.json, assets/, episodes/, director/}` / `images/{index.json, files/}`）。
- 每类资产三态：`present`/`empty`/`not-generated`（后者带中文 reason）；缺数据用带 `schemaVersion` 的空数组/对象，不省略。
- `manifest.json` 顶层：`schemaVersion`、`bookId`、`snapshotId`、`generatedAt`（=快照创建时间，重复打包不重取）、`sourceType`、各类别状态、`files[]`（规范化 UTF-8 相对路径、bytes、mime、etag/version、sha256，按路径排序）。
- `stableStringify`：键字母序、数组按既定 key 排序、无尾随空白、UTF-8。
- 路径安全：相对路径拒绝绝对/盘符/反斜杠/`.`/`..`/NUL。
- `images/index.json`：实体类型/名/主图/mime/相对路径/sha256，与二进制同时存在。
- 排除：密码、令牌、API Key、运行中任务、内部日志、本机绝对路径。

- [ ] **Step 1：写失败测试** — `stableStringify` 确定性；路径安全拒绝全集；三态中文 reason；fixture→manifest 与 `golden-manifest.json` 深度相等；manifest 文件清单按路径排序；sha256 针对最终字节。
- [ ] **Step 2：确认失败**。
- [ ] **Step 3：实现** + 提交 golden fixture（仅源数据 + golden manifest + 期望哈希，**不提交生成 ZIP**）。
- [ ] **Step 4：定向测试**。
- [ ] **Step 5：提交** — `feat(snapshot): 确定性 manifest 合同与脱敏 golden 样本` / Constraint: 重复生成结果一致 / Confidence: high / Scope-risk: moderate。

### Task B3：确定性 ZIP 打包

**Files:** `api/src/lib/manifest.ts`（`createArchiveZip(manifestEntries)`）+ `zip-deterministic.test.ts`。依赖 `archiver`（固定 `store`/`deflate` 与级别、固定条目时间戳 1980-01-01、固定顺序、固定权限位）。

- [ ] **Step 1：写失败测试** — 同一 manifest 两次打包，逐条目 sha256 一致且整体 ZIP 字节一致（或设计允许的固定差异下哈希一致）；条目时间戳固定；顺序按 manifest 路径排序；路径穿越条目被拒。
- [ ] **Step 2：确认失败**。
- [ ] **Step 3：实现**（archiver `zlib: { level: 9 }`、`forceZip64Format: false`、每条目 `date: new Date(0)` 或 1980 纪元、`mode` 固定）。
- [ ] **Step 4：定向测试**。
- [ ] **Step 5：提交** — `feat(snapshot): 确定性 ZIP 打包` / Rejected: 依赖默认时间戳/压缩（不可重现） / Confidence: high / Scope-risk: narrow。

### Task B4：asset-snapshot 收集任务 + collector

**Files:** `api/src/snapshot/collector.ts`+测试、`api/src/services/snapshot.service.ts`、`job-worker.service.ts`（处理 `asset-snapshot`）。

**行为：**
- Worker 领取 `kind=asset-snapshot`（`uniqueKey = bookId:contentRevision:asset-snapshot`），心跳。
- `collector.collect({ bookId, ownerId, snapshotId })`：经 `AssetSourceResolver` 读取原书、三类实体 JSON、审核（current/history）、NoiseOverride、章节大纲+清洗（实时计算并物化）、`extraction/latest`（run-summary + prescan + entities 富产物）、故事产物（segments/assets/episodes/director）、`images/index.json` + 图片二进制 → 每项写 `ObjectStore.put` + `AssetObjectRepository.putIfAbsent`（去重）+ `SnapshotObjectRepository` 记录 `(logicalPath, category, state, reason)`；生成 manifest → 写 `AssetObject`（manifestObjectId）→ `markReady(snapshotId, manifestObjectId)`。
- 幂等：同 `uniqueKey` 返回现有任务；对象已写但 DB 未提交时，重试按对象键/sha256 识别复用，不覆盖。
- 失败：中文 `failureReason`，敏感 SDK 错误仅日志；可重试 ≤3 次。

- [ ] **Step 1：写失败测试** — 收集产出完整 `SnapshotObject` 集与 manifest；缺三类产物时 `empty`/`not-generated` + 中文 reason；同 contentRevision 重复只产一个快照；对象去重（同 sha256 一份）；owner 校验。
- [ ] **Step 2：确认失败**。
- [ ] **Step 3：实现** collector + snapshot.service（创建/复用任务、查询）+ worker 处理分支。
- [ ] **Step 4：定向测试**。
- [ ] **Step 5：提交** — `feat(snapshot): 快照收集后台任务与幂等` / Constraint: 不可变对象去重复用 / Confidence: high / Scope-risk: broad。

### Task B5：snapshot-archive 打包任务 + worker 守护

**Files:** `api/src/services/snapshot.service.ts`、`job-worker.service.ts`（处理 `snapshot-archive` + 启动轮询）、`api/src/app.ts`（启动 worker）。

**行为：**
- 快照 `ready` 后入队 `kind=snapshot-archive`（`uniqueKey = snapshotId:snapshot-archive`）；读 manifest → `createArchiveZip` → `ObjectStore.put` → `AssetObjectRepository.putIfAbsent`（archiveObjectId）→ `markArchive(snapshotId, archiveObjectId)`。
- 幂等：同对象键复用；ZIP 已写未提交按 sha256 识别。
- worker：`startWorker(intervalMs=1000)`，`claimNext({ kinds: ['asset-snapshot','snapshot-archive'], leaseMs })`，处理循环 + 心跳，启动时 `recoverExpired`；从 `app.ts` 启动一次（仿 `extraction.service.ts:13` 启动 `TaskDispatcher`）。

- [ ] **Step 1：写失败测试** — ready 快照打包出唯一 ZIP；重复任务返回同一 archiveObjectId 不重写；worker 崩溃后租约过期可恢复且不产重复业务结果；超过 3 次稳定失败（中文原因）。
- [ ] **Step 2：确认失败**。
- [ ] **Step 3：实现** archive 分支 + worker 守护 + `app.ts` 启动。
- [ ] **Step 4：定向测试 + 全量回归**。
- [ ] **Step 5：提交** — `feat(jobs): 快照打包后台任务与轮询守护` / Constraint: 复用 BackgroundJob 租约，不新建队列 / Confidence: high / Scope-risk: broad。

---

## 批次 C：下载授权与界面

### Task C1：下载状态 API + 签名下载 + ETag/Range + 所有权

**Files:** `api/src/routes/snapshots.ts`、`api/src/routes/object-download.ts`、`api/src/services/snapshot.service.ts`、`ownership.integration.test.ts`。

**HTTP（全部 owner-scoped，不存在/无权统一 `BOOK_NOT_FOUND` 中文 404）：**
- `GET /books/:id/download-state` → `{ state: not-prepared|preparing|ready|needs-update|failed, progress, snapshotVersion?, readyAt?, bytes?, failureReason? }`（`needs-update` = 有 ready 快照但 `computeContentRevision` 与当前不一致）。
- `POST /books/:id/snapshots` → 创建/复用快照任务（`asset-snapshot`），返回 `snapshotId` 与任务状态。
- `GET /books/:id/snapshots/:snapshotId` → 状态 + 脱敏 manifest 摘要（不含对象键/签名）。
- `POST /books/:id/snapshots/:snapshotId/download-authorizations` → 仅 `ready`：`{ url, expiresAt, etag, versionId?, bytes }`，`url` 由 `ObjectStore.createDownloadUrl(archiveObjectId 对应的对象键)` 产生（Fs=内部 HMAC 端点；S3=presign）。客户端不可提交任意对象键。
- `GET /objects/dl?token=...`（Fs 内部端点）：验证 HMAC token（过期/篡改→中文 401），流式返回 + 支持 `Range`；带 `ETag`/`Accept-Ranges`/`Content-Range`。
- 续传：客户端带原 `If-Range`/`Range` + ETag；版本不一致→中文"数据包版本已更新，请重新下载"。

- [ ] **Step 1：写失败测试** — 四接口 + 内部下载端点：owner 可用、跨账号统一 404、`ready` 才发签名、签名过期重新授权同 ETag、Range 字节与完整对象一致、版本不一致提示。矩阵加入 `ownership.integration.test.ts`。
- [ ] **Step 2：确认失败**。
- [ ] **Step 3：实现** 路由 + service + 内部端点；`app.ts` 注册。
- [ ] **Step 4：定向测试 + 构建**。
- [ ] **Step 5：提交** — `feat(api): 所有权受控的快照下载授权与续传` / Constraint: 签名地址不入库/日志；客户端不能指定对象键 / Confidence: high / Scope-risk: broad。

### Task C2：前端下载状态界面 + 轮询

**Files:** `web/src/api/downloads.ts`、`web/src/components/DownloadStateBadge.tsx`、`web/src/pages/LibraryPage.tsx`（`BookRow`）、`web/src/types.ts`。

**行为：**
- `DownloadStateBadge`（5 态，仿 `StatusBadge.tsx` 的 `Record<State,{label,variant}>`，复用 `Badge` 的 `muted/info/warning/success/destructive`）。
- `downloads.ts`：`downloadStateKey`、`useBookDownloadState`（`refetchInterval` 按状态：`preparing`→3000，终态→false，仿 `extraction.ts`）、`usePrepareDownload`、`useRequestDownloadUrl`（返回签名 URL，浏览器 `fetch` + `Range` 触发下载，Blob/`a[download]`，卸载 revoke）。
- `BookRow`：`BookStatusBadge` 旁加 `DownloadStateBadge`；动作按钮按状态（准备完整下载 / 准备中禁用+`Progress` / 下载完整数据 / 更新数据包 / 重新准备）；准备失败显示中文原因。
- 令牌仅内存（`apiFetch` 自动）；签名 URL 不写缓存/日志。

- [ ] **Step 1：写失败测试** — Badge 5 态映射；`refetchInterval` 终态停止；准备→轮询→就绪→下载触发；失败显示中文原因；签名 URL 不入 localStorage。
- [ ] **Step 2：确认失败**。
- [ ] **Step 3：实现**。
- [ ] **Step 4：前端测试 + lint + 构建 + api 构建**。
- [ ] **Step 5：提交** — `feat(web): 云端书库完整下载状态界面` / Constraint: 访问令牌与签名 URL 不持久化 / Confidence: high / Scope-risk: moderate。

---

## 收尾

### Task D1：阶段二完成门与证据留档

**Files:** `scripts/verify-phase2.ps1`、`storage/src/verify-phase2-script.test.ts`（静态断言脚本含 MinIO up/down、try/finally、移除 DB env）、`docs/superpowers/evidence/phase2/README.md`。

- [ ] **Step 1：完成门脚本**（仿 `verify-phase1.ps1`）：`test:postgres:up` + `test:minio:up` → 注入 `TEST_DATABASE_URL` + 对象存储测试配置 → `db:migrate:deploy` → `pnpm test` → `pnpm build` → `pnpm check:workspace-deps` → `git status --short`；finally 清理 PG + MinIO。
- [ ] **Step 2：运行完成门**，记录退出码、测试数、migration 名、构建结果、提交哈希。
- [ ] **Step 3：敏感信息扫描**（`rg` 同阶段一模式 + `X-Amz-`、对象签名、对象键前缀），证据只记命令名/退出码/数量/哈希/结论。
- [ ] **Step 4：独立 reviewer + verifier**（对照规格第 7–10、13 节；verifier 重跑完成门 + MinIO）。
- [ ] **Step 5：提交** — `docs(evidence): 留档云端书库阶段二验证结果` / Constraint: 证据不含原文/图片/邮箱/签名/凭据 / Confidence: high / Scope-risk: narrow。

---

## 完成门（设计文档第 12.3）

- 同一快照重复打包：manifest、各文件 sha256、ZIP 整体哈希一致。
- 跨账号查询/下载快照被拒（统一中文 404）。
- 签名过期重新授权返回同一 ETag；Range 内容与完整对象一致；版本不一致中文提示。
- golden manifest 与完整 ZIP SHA-256 通过。
- 全量测试 + 构建 + 工作区依赖检查通过。
- MinIO 容器/测试 bucket 在验证后清理。
- 证据脱敏，无未解决 P0/P1。

## 端到端验证（手动）

1. `pnpm test:postgres:up && pnpm test:minio:up`，配置 `OBJECT_STORAGE_*`。
2. 注册账号 A，上传一本书，完成提取（产出 `output/{runDir}`）。
3. 书库点"准备完整下载" → 状态 `准备中`→`可下载`。
4. "下载完整数据"得 ZIP，本地校验：结构、各 JSON `schemaVersion`、`images/index.json` 与图片对应、manifest 中 sha256 与文件一致。
5. 账号 B 登录不可见 A 的书与快照（404）。
6. 重新提取后状态变 `需要更新`，再次准备得新版本 ZIP，旧版本仍可下载至签名过期。
7. `pnpm test:postgres:down && pnpm test:minio:down` 清理。
