-- 阶段三补丁：BookShare 同书+接收方在非撤销状态下的唯一性（防并发创建重复 active 分享）。
-- 部分唯一索引：仅对 active/copying/copied 生效；revoked 可重复（允许撤销后重新分享）。
CREATE UNIQUE INDEX "BookShare_bookId_recipientId_active_uniq"
  ON "BookShare"("bookId", "recipientId")
  WHERE "status" IN ('active', 'copying', 'copied');
