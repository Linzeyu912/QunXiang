# 云端书库阶段三：指定账号分享与独立复制 Implementation Plan

> TDD 逐任务（先写失败测试→确认失败→最小实现→定向测试+构建→独立提交），步骤用 `- [ ]`。

**Goal:** 所有者可把指定书籍的当前 ready 快照分享给另一个**已注册账号**（邮箱 + 不可猜测分享码双重确认）；接收方可在"分享给我"查看摘要，复制为自己的独立书籍（独立版本线、对象复用、不影响原书）。

**Architecture:** 复用阶段一账号/分享码/所有权/审计与阶段二 `AssetSnapshot/AssetObject/SnapshotObject`。新增 `BookShare`（active/copying/copied/revoked 状态机）+ `Book.sourceBookId/sourceShareId`（复制来源审计）。分享创建锁定 ready 快照；复制走后台 `BackgroundJob`（kind=`book-copy`），事务内 active→copying、新建目标 Book+AssetSnapshot+SnapshotObject（**复用底层不可变 AssetObject**，不复制字节）、commit→copied；失败回滚目标记录并恢复 active。撤销与复制竞态由条件 UPDATE 先成功者决定。

**Tech Stack:** TypeScript ESM、Fastify、Prisma、PostgreSQL、@aws-sdk（对象存储）、React、Vitest、Docker。

## 上游与基线
- 上位设计：`docs/superpowers/specs/2026-07-15-cloud-library-asset-sharing-design.md` 第 5.3、7、8 节
- 阶段一/二已完成（账号、PG、对象存储、快照、下载）；证据 `docs/superpowers/evidence/phase1`、`phase2`

## Global Constraints
- 继承阶段一/二：中文文案/错误；migrate deploy 禁 db push；owner-scoped 404 不泄露；签名/对象键不泄露；ESM `.js` 导入；factory+singleton 仓储；测试 MinIO+PG。
- 分享码：复用阶段一 `User.shareCodeHash` + `verifyShareCode`（恒定时间）；邮箱 `normalizeEmail`；邮箱与分享码必须指向同一账号；禁止分享给自己。
- 分享接口失败统一"无法分享给该账号，请核对邮箱和分享码"+ 按发送者限流 + 审计，避免枚举注册邮箱。
- 同一书 + 同一接收方最多一个非撤销分享（重复返回当前）。
- 原子状态机：`active→copying` 与 `active→revoked` 由条件 UPDATE 先成功者决定；已撤销绝不能复制。
- 对象复用：复制时底层 `AssetObject` 复用（不复制字节），为目标 `AssetSnapshot` 新建 `SnapshotObject` 引用；引用数仍由关系事务计算。
- 复制副本独立：新书归接收方，独立 ID/版本线；不随原分享撤销或原书删除消失（原书删除时 `Book.sourceBookId` 置空，不授访问权）。
- 复制为审计写入 `AuditLog`。

## 数据模型（新增 migration）
```prisma
model BookShare {
  id           String    @id @default(uuid()) @db.Uuid
  bookId       String    @db.Uuid
  book         Book      @relation("BookShares", fields: [bookId], references: [id], onDelete: Cascade)
  snapshotId   String    @db.Uuid
  snapshot     AssetSnapshot @relation("SnapshotShares", fields: [snapshotId], references: [id], onDelete: Restrict)
  senderId     String    @db.Uuid
  recipientId  String    @db.Uuid
  status       String    @default("active") // active|copying|copied|revoked
  failureReason String?
  createdAt    DateTime  @default(now()) @db.Timestamptz(3)
  claimedAt    DateTime? @db.Timestamptz(3)
  copiedAt     DateTime? @db.Timestamptz(3)
  revokedAt    DateTime? @db.Timestamptz(3)
  @@index([recipientId, status])
  @@index([bookId, status])
  @@index([senderId])
}
```
`Book` 加 `sourceBookId String? @db.Uuid`、`sourceShareId String? @db.Uuid`（复制来源审计）+ `bookShares BookShare[] @relation("BookShares")`。`AssetSnapshot` 加 `shares BookShare[] @relation("SnapshotShares")`。
migration 末尾追加 `BookShare_status_check IN ('active','copying','copied','revoked')`。

## 批次 D：分享

### Task D1：BookShare 模型与仓储
**Files:** schema.prisma、新 migration、`storage/src/book-share.repository.ts`+test、`storage/src/index.ts`、`postgresql-baseline.integration.test.ts`。
**仓储接口：** `create({bookId,snapshotId,senderId,recipientId})`（同书同接收方非撤销唯一，已存在返回当前）、`findActiveByBookAndRecipient(bookId,recipientId)`、`findOwnedById(id,senderId)`、`findSharedWithMe(recipientId)`、`revoke(id,senderId,now)`（条件 active→revoked）、`markCopying(id,recipientId,snapshotId,now)`（条件 active+snapshot→copying，返回是否成功）、`markCopied(id,recipientId,targetBookId,now)`、`markFailed(id,reason,now)`（copying→active 恢复）、`findClaimable(id,recipientId)`。
- [ ] TDD：状态机条件更新、唯一约束、owner/recipient 校验、baseline 断言。

### Task D2：分享 API + 分享码校验 + 限流
**Files:** `api/src/services/share.service.ts`+test、`api/src/routes/shares.ts`、`api/src/app.ts`、`snapshots.integration.test.ts`/新 `shares.integration.test.ts`。
**HTTP（owner-scoped 中文 404）：**
- `POST /books/:id/shares` `{recipientEmail, recipientShareCode}`：normalizeEmail → 查 recipient → verifyShareCode(码, recipient.shareCodeHash) → 邮箱码同账号 → 禁止自己 → 锁定 book 当前 ready 快照（无则 409"该书籍尚无可分享的完整数据包"）→ `BookShareRepository.create`（复用）+ 审计。失败统一"无法分享给该账号，请核对邮箱和分享码"。
- `GET /shares/shared-with-me`：返回接收方视角摘要（书名、所有者显示名、状态、大小、分享时间；不含对象键/签名）。
- `POST /shares/:id/revoke`：发送者撤销（active→revoked）。
- 分享创建按 senderId 限流（复用 `@fastify/rate-limit`）。
- [ ] TDD：正确邮箱+码定位唯一接收账号；错误邮箱/码/指向不同账号/分享给自己统一失败；跨账号 404；撤销。

## 批次 E：复制

### Task E1：复制 API + worker + 原子状态机 + 对象复用
**Files:** `share.service.ts`（copy 入口）、`job-worker.service.ts`（加 `book-copy` kind）、`api/src/snapshot/book-copy.ts`（复制事务）、`storage/src/book-share.repository.ts`（状态机）。
**流程：**
- `POST /shares/:id/copy`（接收方）：`findClaimable(id, recipientId)` → 校验 status active + snapshot ready + archiveObjectId → `enqueue({kind:'book-copy', uniqueKey:`${shareId}:${recipientId}:book-copy`, payload:{shareId,recipientId}, reactivate:true})` → 返回 copying/已 copied 复用。
- worker `book-copy`：事务内 `markCopying`（条件 active+snapshotId）失败则放弃（撤销先成功）；成功后：
  1. 新建目标 `Book`（title 复制自原书、ownerId=recipientId、sourceBookId=原书、sourceShareId=share、filePath=''）。
  2. 新建目标 `AssetSnapshot`（bookId=目标、ownerId=recipientId、version=1、contentRevision 复制自原快照、status=building）。
  3. 复制 `SnapshotObject`：遍历原快照 objects → `SnapshotObjectRepository.bulkCreate(目标snapshotId, 同 objectId 复用)`（底层 AssetObject 不复制字节）。
  4. 目标 manifest + archive：目标快照复用原 manifestObjectId/archiveObjectId（同对象）或新建引用 → `markReady` + `markArchived` + `BookRepository.setCurrentSnapshot(目标bookId, 目标snapshotId)`（原生 SQL 不刷新 updatedAt）。
  5. `markCopied(shareId, recipientId, targetBookId)` + 审计。
  - 失败：删目标 Book/Snapshot（未提交）+ `markFailed`（copying→active 恢复）+ 中文原因。
- **竞态**：撤销 `revoke`(active→revoked) vs 复制 `markCopying`(active→copying) 由条件 UPDATE 先成功者；`book-copy` worker 若 `markCopying` 返回 false（已被撤销）→ no-op complete。
- **对象复用**：底层 AssetObject 被新旧快照共同引用，引用数正确（关系事务）；删除时不误删。
- [ ] TDD：复制产一个目标 Book+Snapshot+SnapshotObject；复用 AssetObject；撤销先于复制则复制 no-op；复制先于撤销则复制成功；失败回滚恢复 active；重复请求同结果；复制后双方独立、对象引用计数正确。

## 批次 F：前端

### Task F1：分享与"分享给我"界面
**Files:** `web/src/api/shares.ts`、`web/src/components/ShareDialog.tsx`、`web/src/pages/SharedWithMePage.tsx`、`App.tsx`（路由 `/shared`）、`LibraryPage.tsx`（BookRow 加"分享"按钮）。
- 分享对话框：输入接收方邮箱 + 分享码 → POST shares；成功/失败中文提示。
- 分享给我页：摘要列表 + 状态徽标 + "复制到我的书库"按钮（复制中轮询、复制完成跳新书）。
- 发送者撤销按钮。
- 访问令牌仅内存。
- [ ] TDD：分享对话框提交、分享给我列表、复制触发、撤销。

## 收尾 G

### Task G1：完成门与证据
**Files:** `scripts/verify-phase3.ps1`（仿 phase2）、`storage/src/verify-phase3-script.test.ts`、`docs/superpowers/evidence/phase3/README.md`。
- 完成门：`pnpm test`/`build`/`check:workspace-deps`/敏感扫描 + 容器清理。
- 独立 review（分享码校验、状态机竞态、对象复用引用计数、跨账号隔离）。

## 完成门（设计第 13.2/15）
- 撤销与 worker 领取并发只一方成功；已撤销绝不能复制。
- 复制产生独立版本线；删除原书不影响副本；对象最后一个引用删除后才回收。
- 错误邮箱/码统一失败且限流；正确邮箱+码定位唯一接收账号。
- 跨账号无法访问他人分享。
- 全量测试 + 构建通过；证据脱敏。

## 端到端验证
1. 账号 A 上传书→提取→准备下载（ready 快照）。
2. 账号 B 在账号页拿到分享码，线下给 A。
3. A 用 B 邮箱+码分享；B 在"分享给我"见摘要。
4. B 复制→"我的书库"见独立副本；A 撤销/删除原书不影响 B 副本。
5. C 账号无法访问 A/B 的分享。
