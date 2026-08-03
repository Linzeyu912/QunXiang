-- AlterTable: Book 复制来源审计字段（裸列，无外键，避免原书删除连锁）
ALTER TABLE "Book" ADD COLUMN "sourceBookId" UUID,
ADD COLUMN     "sourceShareId" UUID;

-- CreateTable: 指定账号分享
CREATE TABLE "BookShare" (
    "id" UUID NOT NULL,
    "bookId" UUID NOT NULL,
    "snapshotId" UUID NOT NULL,
    "senderId" UUID NOT NULL,
    "recipientId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "failureReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMPTZ(3),
    "copiedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "BookShare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BookShare_recipientId_status_idx" ON "BookShare"("recipientId", "status");

-- CreateIndex
CREATE INDEX "BookShare_bookId_status_idx" ON "BookShare"("bookId", "status");

-- CreateIndex
CREATE INDEX "BookShare_senderId_idx" ON "BookShare"("senderId");

-- AddForeignKey: bookId → Book（删书级联删分享）
ALTER TABLE "BookShare" ADD CONSTRAINT "BookShare_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: snapshotId → AssetSnapshot（限制删除，保护锁定快照）
ALTER TABLE "BookShare" ADD CONSTRAINT "BookShare_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "AssetSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Add CHECK constraint (阶段三状态机值域,名称固定)
ALTER TABLE "BookShare"
  ADD CONSTRAINT "BookShare_status_check"
  CHECK ("status" IN ('active', 'copying', 'copied', 'revoked'));
