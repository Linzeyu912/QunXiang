-- AlterTable
ALTER TABLE "Book" ADD COLUMN     "currentSnapshotId" UUID,
ADD COLUMN     "sourceObjectKey" TEXT;

-- AlterTable
ALTER TABLE "EntityImage" ADD COLUMN     "objectKey" TEXT;

-- CreateTable
CREATE TABLE "AssetObject" (
    "id" UUID NOT NULL,
    "sha256" TEXT NOT NULL,
    "bytes" BIGINT NOT NULL,
    "mime" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "etag" TEXT,
    "versionId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetObject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetSnapshot" (
    "id" UUID NOT NULL,
    "bookId" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "contentRevision" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'building',
    "manifestObjectId" UUID,
    "archiveObjectId" UUID,
    "failureReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readyAt" TIMESTAMPTZ(3),

    CONSTRAINT "AssetSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SnapshotObject" (
    "id" UUID NOT NULL,
    "snapshotId" UUID NOT NULL,
    "objectId" UUID NOT NULL,
    "logicalPath" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SnapshotObject_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AssetObject_objectKey_key" ON "AssetObject"("objectKey");

-- CreateIndex
CREATE INDEX "AssetObject_sha256_idx" ON "AssetObject"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "AssetObject_sha256_bytes_key" ON "AssetObject"("sha256", "bytes");

-- CreateIndex
CREATE INDEX "AssetSnapshot_bookId_status_idx" ON "AssetSnapshot"("bookId", "status");

-- CreateIndex
CREATE INDEX "AssetSnapshot_ownerId_idx" ON "AssetSnapshot"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "AssetSnapshot_bookId_version_key" ON "AssetSnapshot"("bookId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "AssetSnapshot_book_content_revision" ON "AssetSnapshot"("bookId", "contentRevision");

-- CreateIndex
CREATE INDEX "SnapshotObject_objectId_idx" ON "SnapshotObject"("objectId");

-- CreateIndex
CREATE INDEX "SnapshotObject_snapshotId_idx" ON "SnapshotObject"("snapshotId");

-- CreateIndex
CREATE UNIQUE INDEX "SnapshotObject_snapshotId_logicalPath_key" ON "SnapshotObject"("snapshotId", "logicalPath");

-- AddForeignKey
ALTER TABLE "AssetSnapshot" ADD CONSTRAINT "AssetSnapshot_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SnapshotObject" ADD CONSTRAINT "SnapshotObject_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "AssetSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SnapshotObject" ADD CONSTRAINT "SnapshotObject_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "AssetObject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Add CHECK constraints (阶段二值域契约,名称与值域固定,不得自由改名)
ALTER TABLE "AssetSnapshot"
  ADD CONSTRAINT "AssetSnapshot_status_check"
  CHECK ("status" IN ('building', 'ready', 'failed'));

ALTER TABLE "SnapshotObject"
  ADD CONSTRAINT "SnapshotObject_state_check"
  CHECK ("state" IN ('present', 'empty', 'not-generated'));
