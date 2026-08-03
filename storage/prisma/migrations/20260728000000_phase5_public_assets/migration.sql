-- CreateTable: 公共素材（实体卡的不可变快照）
CREATE TABLE "PublicAsset" (
    "id" UUID NOT NULL,
    "publisherId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "summary" TEXT,
    "tags" JSONB NOT NULL DEFAULT '[]',
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'published',
    "takenCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PublicAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PublicAsset_status_kind_idx" ON "PublicAsset"("status", "kind");
CREATE INDEX "PublicAsset_publisherId_idx" ON "PublicAsset"("publisherId");
CREATE INDEX "PublicAsset_status_takenCount_idx" ON "PublicAsset"("status", "takenCount");

-- Add CHECK constraint (status 值域)
ALTER TABLE "PublicAsset"
  ADD CONSTRAINT "PublicAsset_status_check"
  CHECK ("status" IN ('published', 'unlisted', 'removed'));

-- CreateTable: 公共素材图片引用（指向 AssetObject，字节不复制）
CREATE TABLE "PublicAssetImage" (
    "id" UUID NOT NULL,
    "publicAssetId" UUID NOT NULL,
    "assetObjectId" UUID NOT NULL,
    "objectKey" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "aspectRatio" TEXT,
    "stage" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PublicAssetImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PublicAssetImage_publicAssetId_idx" ON "PublicAssetImage"("publicAssetId");
CREATE INDEX "PublicAssetImage_assetObjectId_idx" ON "PublicAssetImage"("assetObjectId");

-- AddForeignKey: publicAssetId → PublicAsset（删素材级联删图片引用）
ALTER TABLE "PublicAssetImage" ADD CONSTRAINT "PublicAssetImage_publicAssetId_fkey"
  FOREIGN KEY ("publicAssetId") REFERENCES "PublicAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: assetObjectId → AssetObject（限制删除，保护图片对象）
ALTER TABLE "PublicAssetImage" ADD CONSTRAINT "PublicAssetImage_assetObjectId_fkey"
  FOREIGN KEY ("assetObjectId") REFERENCES "AssetObject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable: 拿取记录（计数、防重复拿取提示）
CREATE TABLE "PublicAssetTake" (
    "id" UUID NOT NULL,
    "publicAssetId" UUID NOT NULL,
    "takerId" UUID NOT NULL,
    "targetBookId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicAssetTake_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PublicAssetTake_takerId_idx" ON "PublicAssetTake"("takerId");
CREATE INDEX "PublicAssetTake_publicAssetId_idx" ON "PublicAssetTake"("publicAssetId");
CREATE INDEX "PublicAssetTake_takerId_targetBookId_publicAssetId_idx"
  ON "PublicAssetTake"("takerId", "targetBookId", "publicAssetId");

-- AddForeignKey: publicAssetId → PublicAsset（删素材级联删拿取记录）
ALTER TABLE "PublicAssetTake" ADD CONSTRAINT "PublicAssetTake_publicAssetId_fkey"
  FOREIGN KEY ("publicAssetId") REFERENCES "PublicAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
