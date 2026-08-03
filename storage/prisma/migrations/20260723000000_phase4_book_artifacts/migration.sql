-- CreateTable
CREATE TABLE "BookArtifact" (
    "id" UUID NOT NULL,
    "bookId" UUID NOT NULL,
    "logicalPath" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "bytes" BIGINT NOT NULL,
    "mime" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "BookArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BookArtifact_bookId_idx" ON "BookArtifact"("bookId");

-- CreateIndex
CREATE UNIQUE INDEX "BookArtifact_bookId_logicalPath_key" ON "BookArtifact"("bookId", "logicalPath");

-- AddForeignKey
ALTER TABLE "BookArtifact" ADD CONSTRAINT "BookArtifact_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE CASCADE ON UPDATE CASCADE;
