/*
  Warnings:

  - The required column `stableKey` was added to the `Character` table with a prisma-level default value. This is not possible if the table is not empty. Please add this column as optional, then populate it before making it required.
  - The required column `stableKey` was added to the `Item` table with a prisma-level default value. This is not possible if the table is not empty. Please add this column as optional, then populate it before making it required.
  - The required column `stableKey` was added to the `Location` table with a prisma-level default value. This is not possible if the table is not empty. Please add this column as optional, then populate it before making it required.
  - The required column `stableKey` was added to the `WorldviewSetting` table with a prisma-level default value. This is not possible if the table is not empty. Please add this column as optional, then populate it before making it required.

*/
-- AlterTable
ALTER TABLE "Book" ADD COLUMN     "currentExtractionSessionId" UUID,
ADD COLUMN     "onboardingFeatured" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "preprocessConfirmedRevision" INTEGER,
ADD COLUMN     "sourcePackageId" TEXT,
ADD COLUMN     "sourcePackageVersion" TEXT,
ADD COLUMN     "sourceRevision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sourceType" TEXT NOT NULL DEFAULT 'UPLOAD';

-- AlterTable
ALTER TABLE "BookArtifact" ADD COLUMN     "extractionSessionId" UUID,
ADD COLUMN     "sourceRevision" INTEGER;

-- AlterTable
ALTER TABLE "Character" ADD COLUMN     "archivedAt" TIMESTAMPTZ(3),
ADD COLUMN     "lastSeenExtractionSessionId" UUID,
ADD COLUMN     "lockedFields" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "missingFromLatestRun" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reviewSource" TEXT NOT NULL DEFAULT 'AI',
ADD COLUMN     "stableKey" TEXT NOT NULL DEFAULT md5(random()::text),
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "ExtractionSession" ADD COLUMN     "cancelRequestedAt" TIMESTAMPTZ(3),
ADD COLUMN     "cancelledAt" TIMESTAMPTZ(3),
ADD COLUMN     "estimatedCalls" INTEGER,
ADD COLUMN     "estimatedInputChars" BIGINT,
ADD COLUMN     "failureReason" TEXT,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'LIVE',
ADD COLUMN     "manifest" JSONB,
ADD COLUMN     "maxCalls" INTEGER,
ADD COLUMN     "maxTokens" INTEGER,
ADD COLUMN     "pauseRequestedAt" TIMESTAMPTZ(3),
ADD COLUMN     "promotedAt" TIMESTAMPTZ(3),
ADD COLUMN     "sourceRevision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "startedAt" TIMESTAMPTZ(3),
ADD COLUMN     "usageSummary" JSONB;

-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "archivedAt" TIMESTAMPTZ(3),
ADD COLUMN     "lastSeenExtractionSessionId" UUID,
ADD COLUMN     "lockedFields" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "missingFromLatestRun" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reviewSource" TEXT NOT NULL DEFAULT 'AI',
ADD COLUMN     "stableKey" TEXT NOT NULL DEFAULT md5(random()::text),
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Location" ADD COLUMN     "archivedAt" TIMESTAMPTZ(3),
ADD COLUMN     "lastSeenExtractionSessionId" UUID,
ADD COLUMN     "lockedFields" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "missingFromLatestRun" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reviewSource" TEXT NOT NULL DEFAULT 'AI',
ADD COLUMN     "stableKey" TEXT NOT NULL DEFAULT md5(random()::text),
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "cancelledAt" TIMESTAMPTZ(3),
ADD COLUMN     "completedAt" TIMESTAMPTZ(3),
ADD COLUMN     "extractionSessionId" UUID,
ADD COLUMN     "startedAt" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "WorldviewSetting" ADD COLUMN     "archivedAt" TIMESTAMPTZ(3),
ADD COLUMN     "lastSeenExtractionSessionId" UUID,
ADD COLUMN     "lockedFields" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "missingFromLatestRun" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reviewSource" TEXT NOT NULL DEFAULT 'AI',
ADD COLUMN     "stableKey" TEXT NOT NULL DEFAULT md5(random()::text),
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "EntityReview" (
    "id" UUID NOT NULL,
    "bookId" UUID NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" UUID NOT NULL,
    "entityName" TEXT NOT NULL,
    "actorId" UUID,
    "actorType" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "beforeValue" JSONB,
    "afterValue" JSONB,
    "changedFields" JSONB NOT NULL DEFAULT '[]',
    "reason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EntityReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiUsageRecord" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "bookId" UUID,
    "extractionSessionId" UUID,
    "operation" TEXT NOT NULL,
    "provider" TEXT,
    "model" TEXT,
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "totalTokens" INTEGER,
    "unitCount" INTEGER NOT NULL DEFAULT 1,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "usageSource" TEXT NOT NULL DEFAULT 'UNAVAILABLE',
    "status" TEXT NOT NULL DEFAULT 'SUCCEEDED',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiUsageRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EntityReview_bookId_entityType_entityId_createdAt_idx" ON "EntityReview"("bookId", "entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "EntityReview_bookId_createdAt_idx" ON "EntityReview"("bookId", "createdAt");

-- CreateIndex
CREATE INDEX "AiUsageRecord_userId_createdAt_idx" ON "AiUsageRecord"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AiUsageRecord_bookId_createdAt_idx" ON "AiUsageRecord"("bookId", "createdAt");

-- CreateIndex
CREATE INDEX "AiUsageRecord_extractionSessionId_idx" ON "AiUsageRecord"("extractionSessionId");

-- CreateIndex
CREATE INDEX "BookArtifact_bookId_sourceRevision_idx" ON "BookArtifact"("bookId", "sourceRevision");

-- CreateIndex
CREATE INDEX "Character_bookId_stableKey_idx" ON "Character"("bookId", "stableKey");

-- CreateIndex
CREATE INDEX "Item_bookId_status_idx" ON "Item"("bookId", "status");

-- CreateIndex
CREATE INDEX "Item_bookId_stableKey_idx" ON "Item"("bookId", "stableKey");

-- CreateIndex
CREATE INDEX "Location_bookId_stableKey_idx" ON "Location"("bookId", "stableKey");

-- CreateIndex
CREATE INDEX "WorldviewSetting_bookId_stableKey_idx" ON "WorldviewSetting"("bookId", "stableKey");

-- AddForeignKey
ALTER TABLE "Book" ADD CONSTRAINT "Book_currentExtractionSessionId_fkey" FOREIGN KEY ("currentExtractionSessionId") REFERENCES "ExtractionSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_extractionSessionId_fkey" FOREIGN KEY ("extractionSessionId") REFERENCES "ExtractionSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityReview" ADD CONSTRAINT "EntityReview_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiUsageRecord" ADD CONSTRAINT "AiUsageRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiUsageRecord" ADD CONSTRAINT "AiUsageRecord_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- stableKey 回填完成后移除数据库级默认（后续默认由应用层 Prisma 提供）
ALTER TABLE "Character" ALTER COLUMN "stableKey" DROP DEFAULT;
ALTER TABLE "Item" ALTER COLUMN "stableKey" DROP DEFAULT;
ALTER TABLE "Location" ALTER COLUMN "stableKey" DROP DEFAULT;
ALTER TABLE "WorldviewSetting" ALTER COLUMN "stableKey" DROP DEFAULT;

-- ---- 数据回填（增量、非破坏） ----
-- 分享副本回填为 SHARED_COPY（其余保持默认 UPLOAD；示例书 SEED 由回填脚本按源文件哈希匹配）
UPDATE "Book" SET "sourceType" = 'SHARED_COPY' WHERE "sourceShareId" IS NOT NULL AND "sourceType" = 'UPLOAD';

-- 有人工角色审核记录的实体回填 reviewSource = USER
UPDATE "Character" SET "reviewSource" = 'USER'
WHERE "reviewSource" = 'AI'
  AND EXISTS (SELECT 1 FROM "CharacterReview" r WHERE r."characterId" = "Character"."id");

-- 旧角色审核记录迁移到统一审核表（幂等：仅迁移尚未迁移的记录）
INSERT INTO "EntityReview" (
  "id", "bookId", "entityType", "entityId", "entityName",
  "actorId", "actorType", "action",
  "beforeValue", "afterValue", "changedFields", "createdAt"
)
SELECT
  r."id", c."bookId", 'character', c."id", c."name",
  r."userId", 'USER',
  CASE r."action"
    WHEN 'approve' THEN 'APPROVE'
    WHEN 'reject' THEN 'REJECT'
    ELSE 'EDIT'
  END,
  CASE WHEN r."previousValue" IS NULL THEN NULL
       ELSE jsonb_build_object('value', r."previousValue") END,
  CASE WHEN r."newValue" IS NULL THEN NULL
       ELSE jsonb_build_object('value', r."newValue") END,
  '[]'::jsonb,
  r."createdAt"
FROM "CharacterReview" r
JOIN "Character" c ON c."id" = r."characterId"
WHERE NOT EXISTS (SELECT 1 FROM "EntityReview" e WHERE e."id" = r."id");

-- ---- 一本书同时最多一个活动运行（部分唯一索引） ----
CREATE UNIQUE INDEX "ExtractionSession_book_active_unique"
  ON "ExtractionSession"("bookId")
  WHERE "status" IN ('QUEUED', 'RUNNING', 'PAUSING', 'PAUSED', 'CANCELLING');
