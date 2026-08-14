-- Phase 9: 版本化视觉规格 VisualSpec；图片可挂 visualSpecId

CREATE TABLE "VisualSpec" (
    "id" UUID NOT NULL,
    "bookId" UUID NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityName" TEXT NOT NULL,
    "variantKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "prompt" TEXT NOT NULL,
    "promptSource" TEXT NOT NULL,
    "quality" TEXT,
    "styleTags" JSONB NOT NULL DEFAULT '[]',
    "model" TEXT,
    "primaryImageId" UUID,
    "sourceChapters" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "VisualSpec_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VisualSpec_bookId_entityType_entityName_variantKey_version_key"
    ON "VisualSpec"("bookId", "entityType", "entityName", "variantKey", "version");

CREATE INDEX "VisualSpec_bookId_entityType_entityName_status_idx"
    ON "VisualSpec"("bookId", "entityType", "entityName", "status");

CREATE INDEX "VisualSpec_bookId_status_idx" ON "VisualSpec"("bookId", "status");

ALTER TABLE "VisualSpec" ADD CONSTRAINT "VisualSpec_bookId_fkey"
    FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EntityImage" ADD COLUMN "visualSpecId" UUID;

CREATE INDEX "EntityImage_visualSpecId_idx" ON "EntityImage"("visualSpecId");
