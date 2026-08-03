# 云端书库阶段一：账号与 PostgreSQL 基础 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 移除会破坏真实账号的单机默认账号机制，建立可迁移的 PostgreSQL 数据基线、安全登录会话、后台租约任务和严格账号所有权边界。

**Architecture:** PostgreSQL 是账号与结构化数据的唯一权威源；Fastify 使用短期 Bearer 访问令牌和 HttpOnly 刷新 Cookie；前端只在内存中保存访问令牌。现有提取 `Task` 保持不变，新增独立 `BackgroundJob` 处理后续快照、复制和打包长任务。

**Tech Stack:** TypeScript、Fastify 4、Prisma 5、PostgreSQL 15、React 18、Zustand、Vitest、Docker Compose。

## Global Constraints

- 所有用户可见 UI 文案、错误信息和本阶段新增日志必须使用中文。
- 正式数据库只允许 `prisma migrate deploy/status`，禁止 `db push --accept-data-loss`。
- 邮箱规范化规则固定为 `trim().toLowerCase()`；第一版不验证邮箱。
- 未验证邮箱不能单独作为分享身份；账号分享码必须使用 CSPRNG，只保存摘要。
- 访问令牌只保存在前端内存；刷新令牌只存在 `HttpOnly; Secure; SameSite=Lax` Cookie。
- 不得在 URL、日志、数据库明文字段或 Git 中保存访问令牌、刷新令牌、密码和密钥。
- 每个任务先写失败测试，完成最小实现后运行定向测试，再创建独立提交。
- 设计依据：`docs/superpowers/specs/2026-07-15-cloud-library-asset-sharing-design.md`。
- 留档规则：`docs/superpowers/plans/2026-07-15-cloud-library-roadmap.md`。
- 兼容性决策：`docs/superpowers/decisions/0001-retain-book-user-id-as-owner-column.md`；物理列暂保留 `Book.userId`，服务层统一按 owner 语义使用。

---

## File Structure

### 新增文件

- `api/src/app.ts`：构建可测试 Fastify 实例，不监听端口。
- `api/src/config/auth.ts`：集中解析和验证认证配置。
- `api/src/lib/email.ts`：邮箱规范化。
- `api/src/lib/share-code.ts`：分享码生成、摘要和恒定时间校验。
- `api/src/lib/refresh-token.ts`：opaque 刷新令牌生成与摘要。
- `api/src/lib/request-security.ts`：Origin 和 CSRF 校验。
- `api/src/lib/api-errors.ts`：稳定 `{ code, error }` 中文错误结构。
- `api/src/routes/account.ts`：分享码轮换接口。
- `api/src/services/admin-account.service.ts`：管理员密码重置业务逻辑。
- `api/src/services/admin-account.service.test.ts`：密码重置、会话撤销与脱敏审计测试。
- `api/scripts/reset-user-password.ts`：仅服务器命令行使用的密码重置入口。
- `storage/src/refresh-session.repository.ts`：刷新会话轮换和撤销。
- `storage/src/background-job.repository.ts`：PostgreSQL 租约任务。
- `storage/src/audit-log.repository.ts`：管理操作脱敏审计。
- `core/src/background-job.ts`：后台任务公共类型。
- `storage/prisma/migrations/20260715_postgresql_baseline/migration.sql`：正式 PostgreSQL baseline。
- `storage/src/json-field.ts`：PostgreSQL JSONB 与迁移期遗留 JSON 字符串的唯一编解码边界。
- `scripts/test-database-url.mjs`：测试库地址解析和生产库防误删守卫。
- `scripts/test-runner.mjs`：可替换子进程执行器的自包含 PostgreSQL 测试编排。
- `docker-compose.test.yml`：隔离 PostgreSQL 15 测试服务。
- `web/src/pages/AccountPage.tsx`：展示/轮换分享码。
- `docs/superpowers/evidence/phase1/README.md`：脱敏验证证据索引。

### 删除文件

- `api/src/lib/defaultUser.ts`：破坏性默认账号归并逻辑。

### 重点修改文件

- `storage/prisma/schema.prisma`：切换 PostgreSQL 并增加 User、RefreshSession、BackgroundJob 字段/模型。
- `scripts/test.mjs`：移除硬编码 Prisma 版本和 SQLite 路径，支持定向测试。
- `storage/src/test-setup.ts`：改为读取隔离 PostgreSQL 的 `TEST_DATABASE_URL`。
- `api/src/index.ts`：只加载 `buildApp()` 并监听端口。
- `api/src/routes/auth.ts`：规范化注册登录、刷新 Cookie、轮换和退出。
- `web/src/store/authStore.ts`：删除 localStorage，只保存内存态。
- `web/src/api/client.ts`：单飞刷新、一次重试和 CSRF 请求头。
- `web/src/App.tsx`：启动时刷新会话，不再固定账号登录。
- `storage/src/book.repository.ts`、`api/src/lib/authz.ts`：所有者条件下推。
- `storage/src/character.repository.ts`、`storage/src/location.repository.ts`、`storage/src/item.repository.ts`、`storage/src/entity-image.repository.ts`：实体资源所有者条件下推。
- `api/src/services/story.service.ts`：故事查询与写入统一通过 owner-scoped 仓储边界。

---

### Task 1: 移除默认账号归并和固定账号静默登录

**Files:**
- Create: `api/src/app.ts`
- Delete: `api/src/lib/defaultUser.ts`
- Modify: `api/src/index.ts`
- Modify: `web/src/api/auth.ts`
- Modify: `web/src/App.tsx`
- Test: `api/src/startup-account-safety.test.ts`
- Test: `web/src/api/auth.test.ts`

**Interfaces:**
- Consumes: 当前 `UserRepository`、`useAuthStore`。
- Produces: `buildApp(options): Promise<FastifyInstance>`，只注册插件和路由、不监听端口；无启动期账号写入；无 `DEFAULT_CREDENTIALS` 和 `loginDefaultUser()`。

- [ ] **Step 1: 写启动安全失败测试**

```ts
// api/src/startup-account-safety.test.ts
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('启动账号安全', () => {
  it('启动入口不导入或调用默认账号归并', async () => {
    const source = await readFile(new URL('./index.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('ensureDefaultUser');
    expect(source).not.toContain('./lib/defaultUser');
  });

  it('buildApp 只构建实例且不监听端口、不写入用户', async () => {
    const source = await readFile(new URL('./app.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('.listen(');
    expect(source).not.toContain('ensureDefaultUser');
  });
});
```

```ts
// web/src/api/auth.test.ts
import { describe, expect, it } from 'vitest';
import * as auth from './auth';

describe('前端认证入口', () => {
  it('不再导出固定默认账号凭据或静默登录函数', () => {
    expect('DEFAULT_CREDENTIALS' in auth).toBe(false);
    expect('loginDefaultUser' in auth).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm exec vitest run api/src/startup-account-safety.test.ts web/src/api/auth.test.ts`

Expected: FAIL，指出仍存在 `ensureDefaultUser`、`DEFAULT_CREDENTIALS` 或 `loginDefaultUser`。

- [ ] **Step 3: 删除后端默认账号调用并简化前端启动**

```ts
// web/src/App.tsx 启动期最小行为；Task 6 会替换成刷新 Cookie 恢复
useEffect(() => {
  if (!token) setBootstrapping(false);
}, [token, setBootstrapping]);
```

新增 `api/src/app.ts`，导出 `buildApp(options): Promise<FastifyInstance>`；先注册现有插件与路由，`api/src/index.ts` 仅调用它并监听端口。删除 `ensureDefaultUser` 导入和调用；删除 `api/src/lib/defaultUser.ts`；从 `web/src/api/auth.ts` 删除固定凭据和静默登录函数。

- [ ] **Step 4: 运行定向测试和构建**

Run: `pnpm exec vitest run api/src/startup-account-safety.test.ts web/src/api/auth.test.ts`

Expected: PASS。

Run: `pnpm --filter @novel-agent/api build`

Run: `pnpm --filter @novel-agent/web build`

Expected: 两个命令退出码均为 0。

- [x] **Step 5: 提交**

```powershell
git add api/src/app.ts api/src/index.ts api/src/lib/defaultUser.ts api/src/startup-account-safety.test.ts web/src/App.tsx web/src/api/auth.ts web/src/api/auth.test.ts
git commit -m "fix(auth): 移除默认账号归并和静默登录" -m "Constraint: 保留真实账号与书籍归属" -m "Confidence: high" -m "Scope-risk: narrow"
```

---

### Task 2: 建立可复现的 PostgreSQL 测试通道

**Files:**
- Create: `docker-compose.test.yml`
- Create: `scripts/test-database-url.mjs`
- Create: `scripts/test-runner.mjs`
- Modify: `scripts/test.mjs`
- Modify: `package.json`
- Modify: `storage/package.json`
- Modify: `storage/src/test-setup.ts`
- Test: `storage/src/database-scripts.test.ts`

**Interfaces:**
- Consumes: Docker Compose、Prisma CLI 依赖。
- Produces: 自包含的 `pnpm test -- <files>`：启动隔离 PostgreSQL、注入并校验 `TEST_DATABASE_URL`、执行 reset/test、在 `finally` 清理；也可转发定向测试。
- Script seam: `main({ env, argv, runCommand }): Promise<number>` 委托 `runTests({ env, argv, run }): Promise<number>`；后者接受可替换的子进程执行器，便于在不触碰数据库的单元测试中核对 reset 前安全校验、环境注入和参数转发。

- [ ] **Step 1: 写数据库脚本失败测试**

```ts
// storage/src/database-scripts.test.ts
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('数据库脚本安全', () => {
  it('正式脚本不包含 accept-data-loss', async () => {
    const rootPackage = await readFile(new URL('../../package.json', import.meta.url), 'utf8');
    expect(rootPackage).not.toContain('accept-data-loss');
  });

  it('测试脚本不硬编码 pnpm store 中的 Prisma 版本', async () => {
    const source = await readFile(new URL('../../scripts/test.mjs', import.meta.url), 'utf8');
    expect(source).not.toMatch(/\.pnpm[\\/]prisma@/);
  });

  it('测试脚本强制使用 TEST_DATABASE_URL 并拒绝非测试库', async () => {
    const source = await readFile(new URL('../../scripts/test.mjs', import.meta.url), 'utf8');
    expect(source).toContain('TEST_DATABASE_URL');
    expect(source).toContain('assertSafeTestDatabaseUrl');
  });
});
```

同一测试文件动态导入 `scripts/test-database-url.mjs`，分别调用 `assertSafeTestDatabaseUrl()` 断言缺失地址、非 `_test` 库名、已知正式主机/端口均被拒绝，隔离测试库被接受。

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm exec vitest run storage/src/database-scripts.test.ts`

Expected: FAIL，命中 `accept-data-loss` 和硬编码 `prisma@5.22.0`。

- [ ] **Step 3: 新增隔离 PostgreSQL 并改造测试脚本**

```yaml
# docker-compose.test.yml
services:
  postgres-test:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: novel_agent_test
      POSTGRES_USER: novel_agent_test
      POSTGRES_PASSWORD: novel_agent_test
    ports:
      - "55432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U novel_agent_test -d novel_agent_test"]
      interval: 2s
      timeout: 2s
      retries: 30
```

`scripts/test.mjs` 导出 `main({ env, argv, runCommand }): Promise<number>` 并委托 `scripts/test-runner.mjs` 的 `runTests({ env, argv, run })`；命令行入口向它传真实 `process.env/process.argv` 与子进程执行器。执行器使用 `pnpm exec prisma` 或本地可解析 CLI，不拼接 `.pnpm` 路径。每次执行都先启动 `docker-compose.test.yml` 的 PostgreSQL；若未显式传入 `TEST_DATABASE_URL`，使用该 compose 服务的固定本地测试地址。校验通过后，把同一个值注入子进程的 `DATABASE_URL` 和 `DIRECT_DATABASE_URL`，运行 `prisma generate`、`prisma migrate reset --force --skip-seed`，再把 `process.argv.slice(2)` 传给 Vitest。除非 `KEEP_TEST_DB=1`，无论成功或失败都在 `finally` 执行 `test:postgres:down`。`storage/src/test-setup.ts` 也只使用注入后的测试地址创建 PrismaClient，不再拼接 SQLite 文件路径。

在覆盖任何环境变量前，捕获 `PRODUCTION_DATABASE_URL` 和逗号分隔的 `PRODUCTION_DATABASE_URLS`；原始 `DATABASE_URL/DIRECT_DATABASE_URL` 只有在其规范化值不等于显式 `TEST_DATABASE_URL` 时才加入正式地址拒绝清单，避免完成门已经把三者指向同一测试库时误报。在 `scripts/test-database-url.mjs` 实现并导出 `assertSafeTestDatabaseUrl(value, productionUrls)`：数据库名必须以 `_test` 结尾；测试地址的 `protocol + hostname + port` 不得与拒绝清单中任一可解析地址相同；测试地址完整规范化后也不得与任一正式地址相同。缺失、无法解析或冲突时用中文中止，且必须发生在 generate/reset 之前。`scripts/test.mjs` 必须导入并调用它。

- `missing_test_database_url_is_rejected`
- `database_name_without_test_suffix_is_rejected`
- `known_production_host_and_port_are_rejected`
- `production_urls_are_captured_before_database_url_override`
- `validated_test_url_is_injected_as_database_and_direct_url`
- `targeted_test_files_are_forwarded_after_double_dash`

根脚本固定为：

```json
{
  "db:migrate:dev": "pnpm --filter @novel-agent/storage exec prisma migrate dev --schema=./prisma/schema.prisma",
  "db:migrate:deploy": "pnpm --filter @novel-agent/storage exec prisma migrate deploy --schema=./prisma/schema.prisma",
  "db:migrate:status": "pnpm --filter @novel-agent/storage exec prisma migrate status --schema=./prisma/schema.prisma",
  "test:postgres:up": "docker compose -f docker-compose.test.yml up -d --wait postgres-test",
  "test:postgres:down": "docker compose -f docker-compose.test.yml down -v"
}
```

- [ ] **Step 4: 运行脚本测试**

Run: `pnpm exec vitest run storage/src/database-scripts.test.ts`

Expected: PASS。

Run: `pnpm test:postgres:up`

Expected: `postgres-test` 状态为 healthy。

Run: `pnpm test:postgres:down`

Expected: 测试容器和测试卷被清理。

`database-scripts.test.ts` 用替身子进程验证：安全地址通过后，测试脚本会按“compose up → generate → reset → Vitest → finally compose down”执行，把同一值注入 `DATABASE_URL` 和 `DIRECT_DATABASE_URL`，并原样转发 `--` 后面的文件参数；模拟任一步失败时仍会清理。本任务不对尚未切换 provider 的现有 SQLite schema 执行真实 PostgreSQL reset。第一次真实 `pnpm test -- <files>` 在 Task 3 切换 schema 后执行。

- [ ] **Step 5: 提交**

```powershell
git add docker-compose.test.yml scripts/test.mjs scripts/test-runner.mjs scripts/test-database-url.mjs package.json storage/package.json storage/src/test-setup.ts storage/src/database-scripts.test.ts docs/superpowers/plans/2026-07-15-cloud-library-phase1-accounts-postgresql.md
git commit -m "test(storage): 建立隔离 PostgreSQL 测试通道" -m "Rejected: 继续硬编码 SQLite 测试库 | 无法验证正式 PostgreSQL 约束" -m "Confidence: high" -m "Scope-risk: moderate"
```

---

### Task 3: 建立 PostgreSQL baseline、刷新会话和后台任务模型

**Files:**
- Modify: `storage/prisma/schema.prisma`
- Move: `storage/prisma/migrations/20260521134701_init/migration.sql` -> `storage/prisma/sqlite-legacy/migrations/20260521134701_init/migration.sql`
- Create: `storage/prisma/migrations/20260715_postgresql_baseline/migration.sql`
- Modify: `storage/prisma/migrations/migration_lock.toml`
- Modify: `storage/src/prisma.ts`
- Create: `storage/src/postgresql-baseline.integration.test.ts`
- Create: `storage/src/json-field.ts`
- Create: `storage/src/json-field.test.ts`
- Modify: `storage/src/test-setup.ts`
- Modify: `storage/src/character.repository.ts`
- Modify: `storage/src/location.repository.ts`
- Modify: `storage/src/item.repository.ts`
- Modify: `storage/src/task.repository.ts`
- Modify: `api/.env.example`
- Modify: `core/src/types.ts`
- Modify: `storage/src/user.repository.ts`
- Modify: `storage/src/user.repository.test.ts`
- Create: `storage/src/test-fixtures.ts`
- Modify: `storage/src/book.repository.test.ts`
- Modify: `storage/src/character.repository.test.ts`
- Modify: `storage/src/task.repository.test.ts`
- Modify: `api/src/services/extraction.empty-result.test.ts`
- Modify: `api/src/routes/auth.ts`
- Modify: `scripts/run_producer.mjs`
- Modify: `setup.bat`
- Modify: `start.bat`
- Modify: `start-mock.bat`
- Modify: `README.md`
- Create: `storage/src/postgresql-entrypoints.test.ts`

> 2026-07-15 执行留档：PostgreSQL baseline 把 `User.passwordHash`、`emailNormalized`、`status`、`shareCodeHash` 设为必填，并把主键切换为 UUID。为使本任务在真实 PostgreSQL 上独立通过，原计划 Task 4 中与这些字段直接相关的仓储类型、测试夹具、现有调用点和无效 ID 测试已前移到 Task 3；邮箱规范化、正式分享码生成和账号接口仍由 Task 4 完成。

> 2026-07-15 审查修复留档：独立审查复现 Windows 入口仍写 SQLite URL、遗漏 `DIRECT_DATABASE_URL` 并执行 `db push`，会直接阻断 PostgreSQL 启动，因此三个批处理入口和 README 同步前移到 Task 3，统一改为 `migrate deploy` 并增加静态回归测试。审查还发现 `AuditLog.actorId` 被误设为 UUID；按已批准的多类型审计主体设计恢复为普通可空字符串，并用集成测试断言数据库列为 `text`。

> 2026-07-15 升级路径复审留档：主工作区已有 `.env` 仍可能保存旧 `file:` 地址。三个入口现在会检测旧 SQLite 配置或缺失的 `DIRECT_DATABASE_URL`，用中文中止并要求先备份、迁移；禁止静默覆盖旧配置，避免现有账号和书籍数据丢失。同时修正 `start*.bat` 原有的 `api.env` 路径拼接错误，确保读写目标确实是 `api/.env`。

**Interfaces:**
- Consumes: Task 2 隔离 PostgreSQL。
- Produces: 正式 PostgreSQL schema；`User.emailNormalized`、`shareCodeHash`、`RefreshSession`、`BackgroundJob`、`AuditLog`。

- [ ] **Step 1: 写 baseline 失败测试**

```ts
// storage/src/postgresql-baseline.integration.test.ts
import { PrismaClient } from '@prisma/client';
import crypto from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';

const db = new PrismaClient();
afterAll(() => db.$disconnect());

describe('PostgreSQL baseline', () => {
  it('邮箱规范化值和后台任务唯一键均不可重复', async () => {
    const suffix = crypto.randomUUID();
    let userId: string | undefined;
    try {
      const user = await db.user.create({ data: {
        email: `${suffix}@example.com`, emailNormalized: `${suffix}@example.com`,
        name: '测试用户', passwordHash: 'scrypt$00$00', status: 'ACTIVE',
        shareCodeHash: crypto.createHash('sha256').update(`a:${suffix}`).digest('hex'),
      }});
      userId = user.id;
      await expect(db.user.create({ data: {
        email: `${suffix}@example.com`, emailNormalized: `${suffix}@example.com`,
        name: '重复用户', passwordHash: 'scrypt$00$00', status: 'ACTIVE',
        shareCodeHash: crypto.createHash('sha256').update(`b:${suffix}`).digest('hex'),
      }})).rejects.toMatchObject({ code: 'P2002' });
      await db.backgroundJob.create({ data: { kind: 'test', uniqueKey: suffix, payload: {}, status: 'pending' } });
      await expect(db.backgroundJob.create({ data: { kind: 'test', uniqueKey: suffix, payload: {}, status: 'pending' } })).rejects.toMatchObject({ code: 'P2002' });
    } finally {
      await db.backgroundJob.deleteMany({ where: { uniqueKey: suffix } });
      if (userId) await db.user.deleteMany({ where: { id: userId } });
    }
  });
});
```

同一集成测试文件还必须包含以下具名用例：

- `baseline_contains_every_prisma_model_and_required_index`
- `uuid_timestamptz_and_jsonb_columns_have_expected_postgresql_types`
- `user_status_check_rejects_unknown_value`
- `background_job_status_check_rejects_unknown_value`
- `book_owner_foreign_key_restricts_user_delete`
- `clean_database_migrate_deploy_and_status_succeed`

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm test -- storage/src/postgresql-baseline.integration.test.ts`

Expected: FAIL，Prisma 模型或表不存在。

- [ ] **Step 3: 修改 schema 并生成正式 baseline**

在保留现有业务模型与字段的基础上，新增/变更以下模型边界；下列片段只说明本阶段变化，不代替完整 schema：

```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_DATABASE_URL")
}

model User {
  id              String           @id @default(uuid()) @db.Uuid
  email           String
  emailNormalized String           @unique
  name            String
  passwordHash    String
  status          String           @default("ACTIVE")
  shareCodeHash   String           @unique
  createdAt       DateTime         @default(now()) @db.Timestamptz(3)
  books           Book[]
  reviews         CharacterReview[]
  sessions        ExtractionSession[]
  refreshSessions RefreshSession[]
}

model RefreshSession {
  id        String    @id @default(uuid()) @db.Uuid
  userId    String    @db.Uuid
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  familyId  String    @db.Uuid
  tokenHash String    @unique
  expiresAt DateTime  @db.Timestamptz(3)
  rotatedAt DateTime? @db.Timestamptz(3)
  revokedAt DateTime? @db.Timestamptz(3)
  createdAt DateTime  @default(now()) @db.Timestamptz(3)
  @@index([userId])
  @@index([familyId])
}

model BackgroundJob {
  id             String    @id @default(uuid()) @db.Uuid
  kind           String
  uniqueKey      String    @unique
  status         String    @default("pending")
  payload        Json
  result         Json?
  error          String?
  attempts       Int       @default(0)
  leaseOwner     String?
  leaseExpiresAt DateTime? @db.Timestamptz(3)
  nextRunAt      DateTime  @default(now()) @db.Timestamptz(3)
  createdAt      DateTime  @default(now()) @db.Timestamptz(3)
  updatedAt      DateTime  @updatedAt @db.Timestamptz(3)
  @@index([status, nextRunAt])
  @@index([leaseExpiresAt])
}

model AuditLog {
  id         String   @id @default(uuid()) @db.Uuid
  actorType  String
  actorId    String?
  action     String
  targetType String
  targetId   String
  metadata   Json
  createdAt  DateTime @default(now()) @db.Timestamptz(3)
  @@index([targetType, targetId, createdAt])
}
```

先完成完整 `schema.prisma`，再用以下确定性命令生成空库 baseline，严禁手写一份与 schema 漂移的“近似 SQL”：

Run: `pnpm --filter @novel-agent/storage exec prisma migrate diff --from-empty --to-schema-datamodel ./prisma/schema.prisma --script > ./prisma/migrations/20260715_postgresql_baseline/migration.sql`

每次重新生成 migration 后，按固定顺序只追加一次以下 SQL；约束名称和值域是阶段一契约，不得自由改名：

```sql
ALTER TABLE "User"
  ADD CONSTRAINT "User_status_check"
  CHECK ("status" IN ('ACTIVE', 'DISABLED'));

ALTER TABLE "BackgroundJob"
  ADD CONSTRAINT "BackgroundJob_status_check"
  CHECK ("status" IN ('pending', 'running', 'succeeded', 'failed'));
```

测试读取 migration SQL，断言两个约束名各出现且仅出现一次；集成测试分别插入非法值并确认被 PostgreSQL 拒绝。完整 SQL 还必须包含所有现有模型、索引、唯一约束、UUID/Timestamptz/JSONB 类型，以及 Book/User 外键的限制删除。`storage/src/prisma.ts` 缺少 `DATABASE_URL` 时抛出 `未配置数据库连接地址`，并删除 SQLite fallback 与 PRAGMA。

把现有 `aliases/chapterAppearances/coCharacters/outfits/owners/Task.payload/Task.result` 改为 PostgreSQL `Json`。所有 repository 只通过统一边界读取，迁移期仍能接受旧字符串：

同时在本任务的 `storage/prisma/schema.prisma` 与 baseline migration 中为现有 `Task.bookId` 补上 `book Book @relation(fields: [bookId], references: [id], onDelete: Cascade)`，并在 `Book` 增加反向 `tasks Task[]`；本任务的自包含测试入口执行 `prisma generate` 并断言 relation 可查询，使 Task 8 能把任务授权下推到 `task.book.userId`，Task 8 不再修改 schema。

```ts
// storage/src/json-field.ts
export function decodeJsonField<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') {
    try { return JSON.parse(value) as T; } catch { return fallback; }
  }
  return value as T;
}

export function encodeJsonField<T>(value: T): T {
  return value;
}
```

- [ ] **Step 4: 部署 baseline 并验证**

Run: `pnpm test -- storage/src/postgresql-baseline.integration.test.ts storage/src/postgresql-entrypoints.test.ts storage/src/database-scripts.test.ts storage/src/json-field.test.ts storage/src/user.repository.test.ts storage/src/book.repository.test.ts storage/src/character.repository.test.ts storage/src/task.repository.test.ts api/src/services/extraction.empty-result.test.ts`

Expected: 自包含测试入口完成 generate、空库 reset/migrate、定向测试与 finally 清理；全部 PASS，并明确断言所有表存在、关键列类型为 UUID/Timestamptz/JSONB、两个 CHECK 生效、唯一约束生效、Book/User 外键限制删除。

- [ ] **Step 5: 提交**

```powershell
git add storage/prisma storage/src/prisma.ts storage/src/test-setup.ts storage/src/json-field* storage/src/character.repository.ts storage/src/location.repository.ts storage/src/item.repository.ts storage/src/task.repository* storage/src/user.repository* storage/src/book.repository.test.ts storage/src/test-fixtures.ts storage/src/postgresql-baseline.integration.test.ts storage/src/postgresql-entrypoints.test.ts api/.env.example api/src/routes/auth.ts api/src/services/extraction.empty-result.test.ts core/src/types.ts scripts/run_producer.mjs setup.bat start.bat start-mock.bat README.md docs/superpowers/plans/2026-07-15-cloud-library-phase1-accounts-postgresql.md
git commit -m "feat(storage): 建立 PostgreSQL 正式基线" -m "Constraint: 空库可由 migrate deploy 完整重建" -m "Rejected: 延续 db push | 缺少可审计迁移历史" -m "Confidence: high" -m "Scope-risk: broad"
```

---

### Task 4: 邮箱规范化和账号分享码

**Files:**
- Modify: `api/src/app.ts`
- Create: `api/src/lib/email.ts`
- Create: `api/src/lib/email.test.ts`
- Create: `api/src/lib/share-code.ts`
- Create: `api/src/lib/share-code.test.ts`
- Modify: `storage/src/user.repository.ts`
- Modify: `storage/src/user.repository.test.ts`
- Create: `storage/src/test-fixtures.ts`
- Modify: `storage/src/book.repository.test.ts`
- Modify: `storage/src/character.repository.test.ts`
- Modify: `storage/src/task.repository.test.ts`
- Modify: `api/src/services/extraction.empty-result.test.ts`
- Modify: `scripts/run_producer.mjs`
- Modify: `api/src/routes/auth.ts`
- Create: `api/src/routes/account.ts`
- Create: `api/src/routes/auth.integration.test.ts`
- Create: `web/src/pages/AccountPage.tsx`
- Create: `web/src/pages/AccountPage.test.tsx`
- Create: `web/src/api/account.ts`
- Modify: `web/src/App.tsx`
- Modify: `web/src/api/auth.ts`
- Modify: `web/src/pages/AuthPage.tsx`
- Modify: `web/src/components/layout/AppLayout.tsx`
- Create: `web/src/lib/one-time-share-code.ts`
- Modify: `vitest.config.ts`
- Modify: `core/src/types.ts`

> 2026-07-15 执行留档：Task 3 已提前完成账号必填字段、测试夹具和制片人脚本兼容，本任务不重复改写这些文件。本任务新增 `web/src/api/account.ts` 作为分享码轮换请求边界，并把 Vitest 匹配范围扩展到 `.test.tsx`，避免账号页面测试存在但从未执行。注册与轮换响应增加 `Cache-Control: no-store`；登录响应也同步禁止缓存访问令牌。

> 2026-07-15 安全审查修复留档：统一 Bearer 鉴权入口现在每次校验账号仍存在且为 `ACTIVE`，因此账号停用后既有 JWT 不能继续读取、写入或换发令牌；未知邮箱也使用固定占位 scrypt 哈希走一次等成本校验，降低邮箱计时枚举。注册明文分享码不再经过 `history.state`，改用页面进程内存通道；渲染阶段只读，组件提交后按已展示值清除，兼容 React StrictMode 与并发渲染，刷新时自然清空。

**Interfaces:**
- Produces: `normalizeEmail(value): string`；`createShareCode(): { plain, hash }`；`verifyShareCode(plain, hash): boolean`。
- Produces HTTP: `POST /account/share-code/rotate`；注册响应一次性返回 `shareCode`。
- Route registration: `buildApp()` 注册 `/auth` 与 `/account`；注册、登录与分享码轮换测试全部通过 `app.inject()` 调用真实路由。

- [ ] **Step 1: 写规范化和分享码失败测试**

```ts
// api/src/lib/email.test.ts
import { describe, expect, it } from 'vitest';
import { normalizeEmail } from './email';
it('邮箱去除首尾空格并转为小写', () => {
  expect(normalizeEmail(' User@Example.COM ')).toBe('user@example.com');
});
```

```ts
// api/src/lib/share-code.test.ts
import { describe, expect, it } from 'vitest';
import { createShareCode, verifyShareCode } from './share-code';
it('分享码只保存摘要且错误码无法通过', () => {
  const value = createShareCode();
  expect(value.plain).not.toBe(value.hash);
  expect(verifyShareCode(value.plain, value.hash)).toBe(true);
  expect(verifyShareCode('错误分享码', value.hash)).toBe(false);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm exec vitest run api/src/lib/email.test.ts api/src/lib/share-code.test.ts`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现纯函数和 repository 边界**

```ts
// api/src/lib/email.ts
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}
```

```ts
// api/src/lib/share-code.ts
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
export function shareCodeHash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
export function createShareCode() {
  const plain = randomBytes(32).toString('base64url');
  return { plain, hash: shareCodeHash(plain) };
}
export function verifyShareCode(plain: string, expectedHex: string): boolean {
  const actual = Buffer.from(shareCodeHash(plain), 'hex');
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
```

注册在同一事务中保存 `emailNormalized`、密码哈希和 `shareCodeHash`；登录只按规范化邮箱查询；公共用户对象绝不返回摘要。

`UserRepository.create` 的 `passwordHash/shareCodeHash` 改为必填；删除会静默创建无密码账号的 `findOrCreate`。新增测试夹具并让所有 repository 测试显式传入完整账号：

```ts
// storage/src/test-fixtures.ts
import crypto from 'node:crypto';

export function testUserInput(email: string, name = '测试用户') {
  return {
    email,
    emailNormalized: email.trim().toLowerCase(),
    name,
    passwordHash: 'scrypt$00112233445566778899aabbccddeeff$' + '00'.repeat(64),
    shareCodeHash: crypto.createHash('sha256').update(email).digest('hex'),
    status: 'ACTIVE',
  };
}
```

`scripts/run_producer.mjs` 改为只查找 `PRODUCER_USER_EMAIL` 指定的现有账号；不存在时用中文中止，不创建影子用户。

`buildApp()` 显式注册 auth 与 account 路由。`auth.integration.test.ts` 至少包含以下用例和断言：

- `register_persists_user_and_returns_access_token_and_one_time_share_code`
- `duplicate_email_with_different_case_returns_same_chinese_conflict`
- `login_uses_normalized_email_and_never_returns_password_or_hashes`
- `unknown_email_and_wrong_password_return_same_chinese_error`
- `rotate_share_code_invalidates_previous_code`
- `inactive_account_cannot_login_and_receives_chinese_account_status_error`

`AccountPage` 以中文展示账号邮箱、当前分享码是否已保存的提示和“轮换分享码”动作；明文分享码只在注册或轮换成功后显示一次。`AccountPage.test.tsx` 断言刷新页面后不会从本地存储恢复明文分享码。

- [ ] **Step 4: 运行集成测试和构建**

Run: `pnpm test -- api/src/lib/email.test.ts api/src/lib/share-code.test.ts api/src/routes/auth.integration.test.ts web/src/pages/AccountPage.test.tsx storage/src/user.repository.test.ts`

Expected: PASS；覆盖大小写重复注册、相同登录错误、轮换后旧分享码失效。

Run: `pnpm --filter @novel-agent/api build`

Expected: 退出码 0。

- [ ] **Step 5: 提交**

```powershell
git add api/src/app.ts api/src/lib/email* api/src/lib/share-code* api/src/lib/login-credentials* api/src/routes/auth.ts api/src/routes/account.ts api/src/routes/auth.integration.test.ts web/src/App.tsx web/src/api/account.ts web/src/api/auth.ts web/src/pages/AccountPage* web/src/pages/AuthPage.tsx web/src/components/layout/AppLayout.tsx web/src/lib/one-time-share-code.ts storage/src/user.repository* vitest.config.ts docs/superpowers/plans/2026-07-15-cloud-library-phase1-accounts-postgresql.md
git commit -m "feat(account): 规范化邮箱并加入账号分享码" -m "Constraint: 未验证邮箱不能单独标识分享接收方" -m "Confidence: high" -m "Scope-risk: moderate"
```

---

### Task 5: 刷新会话、Cookie、Origin/CSRF 和管理员重置

**Files:**
- Modify: `api/src/app.ts`
- Create: `api/src/config/auth.ts`
- Create: `api/src/lib/refresh-token.ts`
- Create: `api/src/lib/request-security.ts`
- Create: `api/src/lib/admin-password-input.ts`
- Create: `api/src/lib/admin-password-input.test.ts`
- Create: `storage/src/refresh-session.repository.ts`
- Create: `storage/src/refresh-session.repository.test.ts`
- Create: `storage/src/audit-log.repository.ts`
- Modify: `storage/src/index.ts`
- Modify: `storage/src/user.repository.ts`
- Modify: `storage/src/user.repository.test.ts`
- Modify: `api/src/index.ts`
- Modify: `api/src/routes/auth.ts`
- Modify: `api/src/routes/auth.integration.test.ts`
- Create: `api/src/routes/session.integration.test.ts`
- Create: `api/src/services/admin-account.service.ts`
- Create: `api/src/services/admin-account.service.test.ts`
- Create: `api/scripts/reset-user-password.ts`
- Modify: `api/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Cookie: `na_refresh`，`HttpOnly; Secure; SameSite=Lax; Path=/auth/session`。
- HTTP: `POST /auth/session/refresh`、`POST /auth/session/logout`。
- Repository: `createSession`、`rotateSession`、`revokeCurrent`、`revokeFamily`、`revokeAllForUser`。
- Route matrix: 注册、登录、刷新不要求 Bearer；刷新依赖 Cookie + Origin + CSRF；退出依赖 Bearer + Cookie + Origin + CSRF；其余所有 `POST/PUT/PATCH/DELETE` 统一校验 Origin，受保护路由仍要求 Bearer。
- Admin audit: 密码重置必须在同一业务流程中撤销全部会话，并写入不含密码、令牌、邮箱明文的 `AuditLog`。

> 2026-07-15 执行留档：访问令牌改为 15 分钟；注册/登录签发 30 天 `na_refresh` 安全 Cookie；刷新使用一次性条件轮换并在重放时撤销整个 family；退出撤销当前会话。所有 mutation 统一检查 Origin，刷新和退出额外检查 `X-CSRF-Token`，CORS 开启 credentials。管理员重置在单一事务中更新密码、撤销全部会话并写入脱敏审计。

> 2026-07-15 安全审查修复留档：注册账号和首个 RefreshSession 改由 `UserRepository.createWithRefreshSession` 在同一 Prisma 事务中创建，注入 tokenHash 唯一键失败时账号会回滚；管理员 CLI 禁止在 argv 传明文密码，只接受 `<邮箱> --password-stdin` 并从标准输入读取。两项均有失败路径测试，独立复审无 P0/P1。

- [ ] **Step 1: 写会话轮换失败测试**

```ts
// storage/src/refresh-session.repository.test.ts
it('并发轮换只有一个成功，重放撤销整个 family', async () => {
  const session = await repo.createSession({ userId, familyId, tokenHash, expiresAt });
  const results = await Promise.allSettled([
    repo.rotateSession({ sessionId: session.id, tokenHash, nextTokenHash: 'a'.repeat(64), now }),
    repo.rotateSession({ sessionId: session.id, tokenHash, nextTokenHash: 'b'.repeat(64), now }),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  await expect(repo.rotateSession({ sessionId: session.id, tokenHash, nextTokenHash: 'c'.repeat(64), now })).rejects.toThrow('刷新令牌已被使用');
  expect(await repo.countActiveFamily(familyId)).toBe(0);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm test -- storage/src/refresh-session.repository.test.ts api/src/routes/session.integration.test.ts`

Expected: FAIL，repository 或 session 路由不存在。

- [ ] **Step 3: 实现令牌与请求安全边界**

```ts
// api/src/lib/refresh-token.ts
import { createHash, randomBytes } from 'node:crypto';
export const createRefreshToken = () => randomBytes(32).toString('base64url');
export const refreshTokenHash = (token: string) =>
  createHash('sha256').update(token, 'utf8').digest('hex');
```

```ts
// api/src/lib/request-security.ts
import type { FastifyRequest } from 'fastify';
export function assertTrustedMutation(request: FastifyRequest, allowed: Set<string>) {
  const origin = request.headers.origin;
  if (!origin || !allowed.has(origin)) throw new Error('请求来源不受信任');
}
export function assertCsrfHeader(request: FastifyRequest) {
  if (request.headers['x-csrf-token'] !== '1') throw new Error('缺少安全校验信息');
}
```

`buildApp()` 注册与 Fastify 4 兼容的 `@fastify/cookie@^9.4.0`、CORS `credentials: true`，允许 `X-CSRF-Token` 请求头；JWT 15 分钟有效期，刷新 Cookie 30 天。对所有 mutation 路由增加 Origin hook，refresh/logout 再增加 CSRF 校验。刷新事务用一次性条件更新；重放撤销 family。管理员命令只在服务器本机执行，重置密码后撤销全部会话并写脱敏审计。

`session.integration.test.ts` 至少包含：

- `refresh_without_bearer_but_with_valid_cookie_succeeds`
- `refresh_cookie_has_http_only_secure_same_site_lax_and_scoped_path`
- `refresh_without_cookie_returns_chinese_unauthorized`
- `refresh_with_untrusted_origin_is_rejected`
- `refresh_without_csrf_header_is_rejected`
- `logout_revokes_current_session`
- `cors_preflight_allows_x_csrf_token_and_credentials`
- `non_auth_mutation_with_untrusted_origin_is_rejected`

`refresh-session.repository.test.ts` 还必须覆盖并发只有一次轮换成功、旧令牌重放撤销整个 family、过期会话不可轮换。`admin-account.service.test.ts` 必须断言密码改变、所有 session 被撤销、审计 action/target 正确，并确认审计 metadata 不包含密码、密码哈希、刷新令牌或邮箱明文。

- [ ] **Step 4: 运行定向测试和构建**

Run: `pnpm test -- storage/src/refresh-session.repository.test.ts api/src/routes/session.integration.test.ts api/src/services/admin-account.service.test.ts`

Expected: PASS；覆盖 Cookie 属性、并发轮换、重放、退出、Origin/CSRF 和管理员重置。

Run: `pnpm --filter @novel-agent/api build`

Expected: 退出码 0。

- [ ] **Step 5: 提交**

```powershell
git add api/src/app.ts api/src/index.ts api/src/config/auth.ts api/src/lib/refresh-token.ts api/src/lib/request-security.ts api/src/lib/admin-password-input* api/src/routes/auth.ts api/src/routes/auth.integration.test.ts api/src/routes/session.integration.test.ts api/src/services/admin-account.service* api/scripts/reset-user-password.ts api/package.json pnpm-lock.yaml storage/src/refresh-session.repository* storage/src/audit-log.repository.ts storage/src/user.repository* storage/src/index.ts docs/superpowers/plans/2026-07-15-cloud-library-phase1-accounts-postgresql.md
git commit -m "feat(auth): 加入轮换刷新会话和 CSRF 防护" -m "Constraint: 刷新令牌只存 HttpOnly 安全 Cookie" -m "Confidence: high" -m "Scope-risk: broad"
```

---

### Task 6: 前端内存令牌、单飞刷新和无令牌 URL

**Files:**
- Modify: `web/src/store/authStore.ts`
- Modify: `web/src/api/client.ts`
- Modify: `web/src/api/auth.ts`
- Modify: `web/src/App.tsx`
- Modify: `web/src/api/extraction.ts`
- Modify: `web/src/api/stories.ts`
- Modify: `web/src/api/images.ts`
- Modify: `web/src/api/export.ts`
- Modify: `web/src/pages/AuthPage.tsx`
- Modify: `web/src/pages/ExportPage.tsx`
- Modify: `web/src/components/review/EntityArtifactsSection.tsx`
- Modify: `web/src/main.tsx`
- Create: `web/src/lib/account-query-cache.ts`
- Modify: `api/src/app.ts`
- Modify: `api/src/routes/images.ts`
- Modify: `api/src/routes/auth.ts`
- Test: `web/src/store/authStore.test.ts`
- Test: `web/src/api/client.test.ts`
- Test: `web/src/api/stream-auth.test.ts`
- Test: `web/src/pages/AuthPage.test.tsx`
- Test: `api/src/routes/auth.integration.test.ts`
- Test: `api/src/routes/stale-user-auth.test.ts`

**Interfaces:**
- Consumes: Task 5 session endpoints。
- Produces: 访问令牌仅 Zustand 内存；并发 401 只发起一个 refresh；URL 不含 `access_token`。

> 2026-07-15 执行留档：前端启动时仅凭 HttpOnly 刷新 Cookie 恢复账号，访问令牌不再读写 localStorage；统一请求边界自动携带 Cookie、mutation CSRF 头，并对 401 进行单飞刷新和一次重试。SSE 改为带 Authorization 头的 fetch 流，受保护图片和导出文件改为鉴权 fetch 后生成短生命周期 Blob URL，不再把令牌或受保护下载直接放入 URL。

> 2026-07-15 安全审查修复留档：为 401 重试增加令牌 lineage，账号 A 的失败请求在切换账号 B 后不得使用 B 的令牌重放；启动刷新与新登录并发时不覆盖新登录内存态，登录页在启动恢复结束前禁止提交。认证主体变化和退出会先串行取消在途查询并清空账号查询缓存，防止旧账号书库、正文或晚到响应泄露给新账号；退出接口允许访问令牌过期后刷新并重试。新增账号切换竞态、登录竞态、缓存隔离、过期退出和导出下载回归测试。

- [x] **Step 1: 写前端认证失败测试**

```ts
// web/src/api/stream-auth.test.ts
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
it('流和图片代码不把访问令牌放入 URL', async () => {
  const files = await Promise.all(['extraction.ts', 'stories.ts', 'images.ts'].map((name) =>
    readFile(new URL(`./${name}`, import.meta.url), 'utf8')));
  expect(files.join('\n')).not.toContain('access_token=');
});
```

- [x] **Step 2: 运行测试并确认失败**

Run: `pnpm exec vitest run web/src/store/authStore.test.ts web/src/api/client.test.ts web/src/api/stream-auth.test.ts`

Expected: FAIL，命中 localStorage 和 URL token。

- [x] **Step 3: 实现内存状态和单飞刷新**

```ts
// web/src/api/client.ts 核心单飞边界
let refreshPromise: Promise<string | null> | null = null;
async function refreshAccessToken(): Promise<string | null> {
  refreshPromise ??= refreshSession().finally(() => { refreshPromise = null; });
  return refreshPromise;
}
```

`authStore` 初始 `{ token: null, user: null, bootstrapping: true }`，不读写 localStorage。修改请求附 `X-CSRF-Token: 1`；refresh/logout 使用 `credentials: 'include'`。SSE 改为带 Authorization 的 fetch 流；图片使用鉴权 fetch 转 Blob/Object URL，并在卸载时 revoke。

测试至少包含：

- `auth_store_never_reads_or_writes_local_storage`
- `startup_refresh_restores_user_without_default_login`
- `concurrent_401_requests_share_one_refresh_and_retry_once`
- `failed_refresh_clears_auth_state_without_retry_loop`
- `mutation_requests_send_csrf_header_and_credentials`
- `sse_uses_authorization_header_without_query_token`
- `protected_image_uses_blob_url_and_revokes_it_on_cleanup`

- [x] **Step 4: 运行前端测试、lint 和构建**

Run: `pnpm test -- web/src/store/authStore.test.ts web/src/api/client.test.ts web/src/api/auth.test.ts web/src/api/stream-auth.test.ts`

Expected: PASS。

Run: `pnpm --filter @novel-agent/web lint`

Run: `pnpm --filter @novel-agent/web build`

Run: `pnpm --filter @novel-agent/api build`

Expected: 全部退出码 0。

- [x] **Step 5: 提交**

```powershell
git add web/src/store/authStore* web/src/api/client* web/src/api/auth* web/src/api/extraction.ts web/src/api/stories.ts web/src/api/images.ts web/src/api/stream-auth.test.ts web/src/App.tsx api/src/index.ts
git commit -m "feat(web-auth): 将访问令牌限制在内存" -m "Rejected: localStorage 和 URL token | 可被脚本与日志泄露" -m "Confidence: high" -m "Scope-risk: broad"
```

---

### Task 7: PostgreSQL BackgroundJob 租约仓储

**Files:**
- Create: `core/src/background-job.ts`
- Create: `storage/src/background-job.repository.ts`
- Create: `storage/src/background-job.repository.test.ts`
- Modify: `storage/src/index.ts`
- Modify: `core/src/index.ts`

**Interfaces:**
- Produces: `enqueue`、`claimNext`、`heartbeat`、`complete`、`fail`、`recoverExpired`。
- Constraint: 保留现有 `TaskRepository` 和提取管线语义。
- State contract: `claimNext` 成功时 `attempts + 1`；`heartbeat` 只延长租约；`complete` 写结果、进入 `succeeded` 并清空租约；可重试 `fail` 在 attempts 小于 3 时回到 pending、设置退避并清空租约，否则进入 failed；`recoverExpired` 与可重试失败遵循同一上限，第三次领取后再过期直接进入 failed；空 `kinds` 直接返回 null 且不执行 SQL。

> 2026-07-15 执行留档：新增独立 `BackgroundJobRepository`，不改动现有提取 `TaskRepository`。领取使用 PostgreSQL `FOR UPDATE SKIP LOCKED` 和同一条 CTE UPDATE 原子完成；心跳、完成、失败均同时校验任务 ID、租约持有者和 `running` 状态。可重试失败与过期租约采用 1 秒起步的指数退避，最多领取 3 次；完成、失败或回到待处理时统一清空租约。空任务类型列表在进入数据库前直接返回，内部产生的失败原因均为中文。

- [x] **Step 1: 写并发领取失败测试**

```ts
// storage/src/background-job.repository.test.ts
it('两个 Worker 并发领取不会得到同一任务', async () => {
  await repo.enqueue({ kind: 'test', uniqueKey: crypto.randomUUID(), payload: {} });
  const [a, b] = await Promise.all([
    repo.claimNext({ workerId: 'worker-a', kinds: ['test'], leaseMs: 30_000, now }),
    repo.claimNext({ workerId: 'worker-b', kinds: ['test'], leaseMs: 30_000, now }),
  ]);
  expect([a, b].filter(Boolean)).toHaveLength(1);
});
```

- [x] **Step 2: 运行测试并确认失败**

Run: `pnpm test -- storage/src/background-job.repository.test.ts`

Expected: FAIL，仓储不存在。

- [x] **Step 3: 实现原子领取和租约约束**

```ts
// storage/src/background-job.repository.ts 的原子 claim SQL
import { Prisma } from '@prisma/client';

const rows = await tx.$queryRaw<BackgroundJob[]>(Prisma.sql`
  WITH candidate AS (
    SELECT id FROM "BackgroundJob"
    WHERE status = 'pending'
      AND "nextRunAt" <= ${input.now}
      AND kind IN (${Prisma.join(input.kinds)})
    ORDER BY "createdAt"
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  UPDATE "BackgroundJob" AS job
  SET status = 'running',
      attempts = job.attempts + 1,
      "leaseOwner" = ${input.workerId},
      "leaseExpiresAt" = ${new Date(input.now.getTime() + input.leaseMs)},
      "updatedAt" = NOW()
  FROM candidate
  WHERE job.id = candidate.id
  RETURNING job.*
`);
```

同一事务将领取行改为 `running`、`attempts + 1` 并写 `leaseOwner/leaseExpiresAt`。心跳、完成和失败更新必须同时匹配 `jobId + leaseOwner + running`。`uniqueKey` 冲突返回现有任务；可重试失败最多领取 3 次并设置指数退避，永久错误直接 `failed`。完成、回到 pending 或进入 failed 时都清空 `leaseOwner/leaseExpiresAt`；`claimNext({ kinds: [] })` 返回 null。

`recoverExpired({ now })` 使用一条原子 UPDATE，条件固定为 `status = 'running' AND leaseExpiresAt <= now`：`attempts >= 3` 的行进入 `failed` 并写中文“任务租约已连续三次过期”，其余行回到 `pending` 并按 attempts 设置 `nextRunAt`；两种分支都清空 lease。返回实际更新的任务 ID 和新状态，便于审计与测试。

测试文件至少包含：

- `unique_key_returns_existing_job`
- `empty_kinds_returns_null_without_query`
- `concurrent_workers_claim_only_once`
- `non_owner_cannot_heartbeat_complete_or_fail`
- `heartbeat_extends_lease_without_incrementing_attempts`
- `expired_lease_is_recovered_and_cleared`
- `third_expired_lease_transitions_atomically_to_failed`
- `retryable_failure_backs_off_and_stops_after_third_claim`
- `permanent_failure_clears_lease_and_keeps_chinese_reason`
- `complete_clears_lease_and_persists_result`

- [x] **Step 4: 运行并发、租约和重试测试**

Run: `pnpm test -- storage/src/background-job.repository.test.ts`

Expected: PASS；覆盖唯一键、并发领取、非持有者拒绝、租约恢复、3 次重试和中文失败原因。

- [x] **Step 5: 提交**

```powershell
git add core/src/background-job.ts core/src/index.ts storage/src/background-job.repository* storage/src/index.ts
git commit -m "feat(jobs): 加入 PostgreSQL 租约任务仓储" -m "Constraint: 不改变现有提取 Task 语义" -m "Confidence: high" -m "Scope-risk: moderate"
```

---

### Task 8: 所有权条件下推和中文错误回归

**Files:**
- Modify: `storage/src/book.repository.ts`
- Modify: `storage/src/book.repository.test.ts`
- Modify: `storage/src/character.repository.ts`
- Modify: `storage/src/character.repository.test.ts`
- Modify: `storage/src/location.repository.ts`
- Create: `storage/src/location.repository.test.ts`
- Modify: `storage/src/item.repository.ts`
- Create: `storage/src/item.repository.test.ts`
- Modify: `storage/src/entity-image.repository.ts`
- Create: `storage/src/entity-image.repository.test.ts`
- Modify: `storage/src/review.repository.ts`
- Create: `storage/src/review.repository.test.ts`
- Modify: `storage/src/noise-override.repository.ts`
- Create: `storage/src/noise-override.repository.test.ts`
- Modify: `storage/src/task.repository.ts`
- Modify: `storage/src/task.repository.test.ts`
- Modify: `api/src/lib/authz.ts`
- Create: `api/src/lib/api-errors.ts`
- Modify: `api/src/routes/books.ts`
- Modify: `api/src/routes/characters.ts`
- Modify: `api/src/routes/locations.ts`
- Modify: `api/src/routes/items.ts`
- Modify: `api/src/routes/extract.ts`
- Modify: `api/src/routes/export.ts`
- Modify: `api/src/routes/images.ts`
- Modify: `api/src/routes/stories.ts`
- Modify: `api/src/routes/director.ts`
- Modify: `api/src/routes/artifacts.ts`
- Modify: `api/src/services/story.service.ts`
- Create: `api/src/services/story.service.test.ts`
- Modify: `api/src/services/extraction.service.ts`
- Create: `api/src/services/extraction.ownership.test.ts`
- Modify: `api/src/services/image-generation.service.ts`
- Create: `api/src/services/image-generation.service.test.ts`
- Modify: `api/src/services/artifacts.service.ts`
- Modify: `api/src/services/artifacts.service.test.ts`
- Create: `api/src/routes/ownership.integration.test.ts`
- Create: `api/src/lib/user-visible-copy.test.ts`
- Create: `storage/src/ownership.repository.test.ts`
- Modify: `story-arcs/src/story-asset-io.ts`
- Create: `story-arcs/src/story-asset-io.test.ts`

**Interfaces:**
- Produces repository: `findOwnedById(bookId, ownerId)`、`deleteOwned(bookId, ownerId)`。
- Produces entity repositories: 所有 character/location/item/entity-image 的读取、更新和删除方法都必须同时接收 `bookId + ownerId`，并在单条数据库查询中关联 `Book.userId = ownerId`。
- Produces story service: 所有 story 读取、生成、更新和删除入口先通过 owner-scoped Book 查询；不得接受调用方传入的已加载全局 Book 作为授权证据。
- Produces supporting repositories: Review 必须同时匹配 review.userId 与 character.book.userId；NoiseOverride 必须关联 book.userId；Task 在 PostgreSQL schema 中补 Book relation，并通过 `task.book.userId` 限定查询、删除和状态写入。提取、图片和产物服务的公开方法统一显式接收 `ownerId`。
- Produces HTTP: `404 { code: 'BOOK_NOT_FOUND', error: '书籍不存在或无权访问' }`。

- [x] **Step 1: 写越权失败测试**

```ts
// api/src/routes/ownership.integration.test.ts
it('读取不存在和读取他人书返回完全相同的中文 404', async () => {
  const missing = await app.inject({ method: 'GET', url: `/books/${crypto.randomUUID()}`, headers: authA });
  const foreign = await app.inject({ method: 'GET', url: `/books/${bookB.id}`, headers: authA });
  expect(missing.statusCode).toBe(404);
  expect(foreign.statusCode).toBe(404);
  expect(foreign.json()).toEqual(missing.json());
  expect(foreign.json()).toEqual({ code: 'BOOK_NOT_FOUND', error: '书籍不存在或无权访问' });
});
```

- [x] **Step 2: 运行测试并确认失败**

Run: `pnpm test -- api/src/routes/ownership.integration.test.ts api/src/lib/user-visible-copy.test.ts`

Expected: FAIL，现有路由仍含英文错误或后置所有权比较。

- [x] **Step 3: 将 owner 条件下推到 repository**

```ts
async findOwnedById(id: string, ownerId: string): Promise<Book | null> {
  return db.book.findFirst({ where: { id, userId: ownerId } }) as Promise<Book | null>;
}
```

所有书籍、实体、导出、图片、故事和导演路由使用 owner-scoped 查询；无权限和不存在统一返回 `BOOK_NOT_FOUND`。不得先全局按 ID 读取再比较 `userId`。character/location/item/entity-image/review/noise-override/task 仓储用关系过滤（例如 `where: { id, book: { userId: ownerId } }`）完成单查询授权。story、extraction、image-generation、artifacts 服务的每个公开入口显式接收 `ownerId`，内部不得再调用未限定 owner 的仓储方法。

建立参数化的路由授权矩阵，至少覆盖 books、characters、locations、items、extract、export、images、stories、director、artifacts 的代表性 GET 和 mutation。具体测试名：

- `all_protected_routes_reject_missing_bearer_with_chinese_401`
- `all_book_routes_hide_foreign_book_as_same_404`
- `all_entity_repositories_reject_foreign_owner_in_single_query`
- `story_service_requires_owner_for_read_write_and_delete`
- `extraction_image_and_artifact_services_require_owner_for_every_entrypoint`
- `review_noise_override_and_task_repositories_reject_foreign_owner`
- `foreign_owner_cannot_export_generate_image_or_start_extraction`
- `user_visible_errors_and_new_logs_contain_no_english_fallback`

- [x] **Step 4: 运行权限回归、全量测试和构建**

Run: `pnpm test -- api/src/routes/ownership.integration.test.ts api/src/lib/user-visible-copy.test.ts api/src/routes/stale-user-auth.test.ts api/src/services/story.service.test.ts api/src/services/extraction.ownership.test.ts api/src/services/image-generation.service.test.ts api/src/services/artifacts.service.test.ts storage/src/book.repository.test.ts storage/src/character.repository.test.ts storage/src/location.repository.test.ts storage/src/item.repository.test.ts storage/src/entity-image.repository.test.ts storage/src/review.repository.test.ts storage/src/noise-override.repository.test.ts storage/src/task.repository.test.ts`

Expected: PASS。

Run: `pnpm test`

Run: `pnpm build`

Expected: 全部退出码 0。

**Task 8 执行留档（2026-07-15）**

- TDD RED：新增 `storage/src/ownership.repository.test.ts` 后首次运行 1 个文件、6 个测试，6 个按预期失败；失败原因均为 owner-scoped 仓储接口尚不存在。
- 仓储边界：Book、Character、Location、Item、EntityImage、Review、NoiseOverride、Task 增加 owner-scoped 查询或写入；授权条件通过 `Book.userId` 关系过滤下推。NoiseOverride 的找回写入使用单条 `INSERT ... SELECT ... ON CONFLICT`，只有 owner-scoped Book 存在时才写入。
- 服务边界：story、extraction、image-generation、artifacts 的所有书籍相关公开入口显式接收 `ownerId`，内部先做 owner-scoped Book 或关系查询；路由不再把全局按 ID 读取的对象作为授权证据。
- HTTP 矩阵：`api/src/routes/ownership.integration.test.ts` 覆盖 books、characters、locations、items、extract、export、images、stories、director、artifacts 的 10 个代表 GET、9 个 mutation，以及缺 bearer 的中文 401。越权和不存在均严格返回 `404 { code: 'BOOK_NOT_FOUND', error: '书籍不存在或无权访问' }`。
- 中文回归：`api/src/lib/user-visible-copy.test.ts` 扫描 Task 8 公开路由错误字面量并校验统一授权文案；本任务触及的英文错误和进度流兜底已改为中文。
- 独立安全复审：首次复审发现编码斜杠可把 `storyId` 解码为路径穿越片段，借已授权书籍读取其他账号故事目录。修复前集成测试真实返回 200 并泄露标记数据；修复后所有文件型故事入口先在 owned book 的 segments 文档精确匹配 storyId，底层目录函数再拒绝斜杠、反斜杠、点段、NUL、绝对路径和 containment 越界。复审确认该 P1 已关闭，无剩余 P0/P1。
- 定向验证：`ownership.integration.test.ts`、`ownership.repository.test.ts`、`user-visible-copy.test.ts` 与 `story-asset-io.test.ts` 共 4 个文件、32 个测试通过；其中包含 owner-scoped NoiseOverride 单语句写入成功路径和真实编码目录穿越回归。
- 全量验证：带本地 Prisma 引擎变量执行标准 `pnpm test`，67 个测试文件、333 个测试全部通过，退出码 0；测试脚本成功创建、重置并清理隔离 PostgreSQL。
- 构建验证：API `tsc` 退出码 0；Web `tsc -b && vite build` 退出码 0，仅保留既有的大分块警告。
- 环境事件：第一次标准定向入口因 Docker Hub 拉取返回 EOF，随后确认本机已有 `postgres:15-alpine`，用 `--pull never` 启动隔离容器后完成迁移和验证；该事件未改动产品配置或生产数据。一次测试矩阵初稿在 `beforeAll` 前插值导致 URL 出现 `undefined`，修正为运行时 UUID 模板后 20 个路由用例全部通过。

- [x] **Step 5: 提交**

```powershell
git add storage/src/book.repository* storage/src/character.repository* storage/src/location.repository* storage/src/item.repository* storage/src/entity-image.repository* storage/src/review.repository* storage/src/noise-override.repository* storage/src/task.repository* api/src/lib/authz.ts api/src/lib/api-errors.ts api/src/lib/user-visible-copy.test.ts api/src/routes api/src/services/story.service* api/src/services/extraction.service.ts api/src/services/extraction.ownership.test.ts api/src/services/image-generation.service* api/src/services/artifacts.service*
git commit -m "fix(authz): 下推书籍所有权并统一中文错误" -m "Constraint: 不存在与无权限返回相同 404" -m "Confidence: high" -m "Scope-risk: broad"
```

---

### Task 9: 阶段一证据留档与完成门

**Files:**
- Create: `scripts/verify-phase1.ps1`
- Create: `storage/src/verify-phase1-script.test.ts`
- Create: `docs/superpowers/evidence/phase1/README.md`
- Modify: `docs/superpowers/plans/2026-07-15-cloud-library-phase1-accounts-postgresql.md`

**Interfaces:**
- Consumes: Tasks 1-8 的提交与测试输出。
- Produces: 不含密码、令牌、真实邮箱和原文的完成证据摘要。

- [x] **Step 1: 创建证据模板**

```markdown
# 阶段一验证证据

- 计划基准日期：2026-07-15
- 规格：`docs/superpowers/specs/2026-07-15-cloud-library-asset-sharing-design.md`
- 计划：`docs/superpowers/plans/2026-07-15-cloud-library-phase1-accounts-postgresql.md`
- 实施提交：按 Task 1-8 顺序记录 `git rev-parse <commit>` 的实际输出
- PostgreSQL baseline：记录命令、退出码和 migration 名称
- 数据库环境：只记录使用了 `TEST_DATABASE_URL` 变量，不记录连接字符串的值
- 定向测试：记录测试文件、通过数、失败数和退出码
- 全量测试：记录通过数、失败数和退出码
- API 构建：记录退出码
- Web 构建：记录退出码
- 独立 reviewer：记录代理任务名、结论和问题编号
- 独立 verifier：记录代理任务名、复跑命令和结论
- 未解决事项：没有时写“无”，否则使用 `PHASE1-ISSUE-N` 编号
```

- [x] **Step 2: 运行完成门命令**

先新增完成门脚本；所有外部命令必须通过同一个退出码守卫，数据库清理必须位于真实 `finally`：

```powershell
# scripts/verify-phase1.ps1
$ErrorActionPreference = 'Stop'

function Invoke-Checked([string]$File, [string[]]$Arguments) {
  & $File @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "验证命令失败：$File $($Arguments -join ' ')"
  }
}

try {
  Invoke-Checked 'pnpm' @('test:postgres:up')
  if (-not $env:TEST_DATABASE_URL) {
    $env:TEST_DATABASE_URL = 'postgresql://novel_agent_test:novel_agent_test@127.0.0.1:55432/novel_agent_test'
  }
  $env:DATABASE_URL = $env:TEST_DATABASE_URL
  $env:DIRECT_DATABASE_URL = $env:TEST_DATABASE_URL
  $env:KEEP_TEST_DB = '1'
  Invoke-Checked 'pnpm' @('db:migrate:deploy')
  Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:DIRECT_DATABASE_URL -ErrorAction SilentlyContinue
  Invoke-Checked 'pnpm' @('test')
  Invoke-Checked 'pnpm' @('build')
  Invoke-Checked 'pnpm' @('check:workspace-deps')
  Invoke-Checked 'git' @('status', '--short')
} finally {
  Remove-Item Env:KEEP_TEST_DB -ErrorAction SilentlyContinue
  & pnpm test:postgres:down
  if ($LASTEXITCODE -ne 0) { throw '测试数据库清理失败' }
}
```

`storage/src/verify-phase1-script.test.ts`（符合现有 Vitest `*/src/**/*.test.ts` include）静态断言脚本包含 `$ErrorActionPreference = 'Stop'`、`Invoke-Checked`、`try/finally`、在 `pnpm test` 前移除 `DATABASE_URL/DIRECT_DATABASE_URL` 和清理命令，并用替身命令验证中途失败时后续验证不再执行但清理仍执行。

Run: `powershell -ExecutionPolicy Bypass -File scripts/verify-phase1.ps1`

Expected: 所有命令退出码为 0；失败时立即停止且容器被清理；`git status --short` 只包含证据文档的计划内修改。

- [x] **Step 3: 填写真实结果并复核敏感信息**

证据中只记录命令、环境变量名称、退出码、测试数量、提交哈希和结论，不复制环境变量值。使用以下扫描：

Run: `rg -n "sk-|Bearer\s+|Cookie:|na_refresh=|password=|postgres(?:ql)?://|jdbc:postgresql:|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|eyJ[A-Za-z0-9_-]+\.|X-Amz-(Credential|Signature)|https?://[^ ]+[?&](token|signature)=" docs/superpowers/evidence/phase1`

Expected: 无输出。

- [x] **Step 4: 独立 reviewer 和 verifier 审核**

Reviewer 对照规格第 5、6、7、10、12、13、15 节；Verifier 重跑 Step 2，并复核 `TEST_DATABASE_URL` 安全守卫确实阻止非测试库 reset。任何失败都回到对应任务修复，不得把证据标记为通过。

- [x] **Step 5: 提交留档**

```powershell
git add scripts/verify-phase1.ps1 storage/src/verify-phase1-script.test.ts docs/superpowers/evidence/phase1 docs/superpowers/plans/2026-07-15-cloud-library-phase1-accounts-postgresql.md
git commit -m "docs(evidence): 留档云端账号阶段一验证结果" -m "Constraint: 证据不得包含敏感数据" -m "Confidence: high" -m "Scope-risk: narrow"
```
