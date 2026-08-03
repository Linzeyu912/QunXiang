# ADR 0001：阶段一保留 Book.userId 作为所有者物理列

- 状态：已接受
- 日期：2026-07-15
- 关联规格：`docs/superpowers/specs/2026-07-15-cloud-library-asset-sharing-design.md`
- 关联计划：`docs/superpowers/plans/2026-07-15-cloud-library-phase1-accounts-postgresql.md`

## 背景

已批准规格使用 `ownerId` 表达书籍所有权语义，现有 Prisma 模型、仓储、路由和 SQLite 数据使用的物理列名是 `Book.userId`。阶段一同时要修复账号持久化、切换 PostgreSQL、重建会话安全并收紧所有权边界。如果在同一阶段全库重命名物理列，会扩大迁移和回滚范围，但不会改变用户可见行为。

## 决策

阶段一保留数据库物理列和 Prisma 字段 `Book.userId`。所有新接口、服务参数和文档统一使用 `ownerId` 表达业务语义，仓储负责把 `ownerId` 映射到 `where: { userId: ownerId }`。所有权判断必须下推到数据库查询，不允许先全局读取再在应用层比较。

后续 `AssetSnapshot`、`BookShare` 和复制流程使用明确的 `ownerId` 字段；它们不得沿用含义模糊的 `userId`。若未来决定重命名 `Book.userId`，必须新建独立 ADR 和兼容迁移，保持列重命名前后 ID、所有权及外键行为不变。

## 结果

- 优点：降低阶段一数据库迁移风险，保留现有 Book 外键和历史数据映射，授权语义仍然明确。
- 代价：短期内业务术语与物理字段名不完全一致，仓储层必须维持显式映射。
- 测试要求：所有 owner-scoped 仓储测试必须证明查询条件包含 `Book.userId = ownerId`；跨账号读取、修改、删除都返回与资源不存在相同的中文 404。

## 否决方案

- 阶段一直接把所有 `Book.userId` 重命名为 `ownerId`：否决，因为它把无行为收益的全库重命名与 PostgreSQL、认证和授权修复绑定在同一回滚单元中。
- 继续在路由层读取 Book 后比较 `userId`：否决，因为会扩大越权数据泄漏和遗漏授权检查的风险。
