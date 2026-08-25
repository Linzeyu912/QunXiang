-- 世界观与体系设定实体（灵气/斗气等能量体系、境界等级、组织势力、规则法则）
CREATE TABLE "WorldviewSetting" (
    "id" UUID NOT NULL,
    "bookId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "aliases" JSONB NOT NULL DEFAULT '[]',
    "category" TEXT NOT NULL DEFAULT 'worldview',
    "description" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "chapterRef" TEXT,
    "importanceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tier" TEXT NOT NULL DEFAULT 'candidate',
    "mentionCount" INTEGER NOT NULL DEFAULT 0,
    "firstChapter" INTEGER,
    "lastChapter" INTEGER,
    "chapterAppearances" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WorldviewSetting_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WorldviewSetting_bookId_idx" ON "WorldviewSetting"("bookId");
CREATE INDEX "WorldviewSetting_bookId_status_idx" ON "WorldviewSetting"("bookId", "status");
CREATE INDEX "WorldviewSetting_category_idx" ON "WorldviewSetting"("category");

ALTER TABLE "WorldviewSetting"
ADD CONSTRAINT "WorldviewSetting_bookId_fkey"
FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE CASCADE ON UPDATE CASCADE;
