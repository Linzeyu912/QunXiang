-- 角色年龄成长阶段：仅根据原文证据记录角色跨越的阶段与当前主阶段。
ALTER TABLE "Character" ADD COLUMN "ageStages" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "Character" ADD COLUMN "primaryAgeStage" TEXT;

-- 实体审核页与提取进度的高频查询使用书籍和状态复合索引。
CREATE INDEX "Character_bookId_status_idx" ON "Character"("bookId", "status");
CREATE INDEX "Location_bookId_status_idx" ON "Location"("bookId", "status");
CREATE INDEX "Task_bookId_status_idx" ON "Task"("bookId", "status");
