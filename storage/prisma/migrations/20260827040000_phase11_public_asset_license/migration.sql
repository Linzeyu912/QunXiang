-- 公共素材最小版权声明（实施包 H2）
ALTER TABLE "PublicAsset" ADD COLUMN "licenseType" TEXT;
ALTER TABLE "PublicAsset" ADD COLUMN "licenseNote" TEXT;
ALTER TABLE "PublicAsset" ADD COLUMN "attributionRequired" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PublicAsset" ADD COLUMN "rightsConfirmedAt" TIMESTAMPTZ(3);
