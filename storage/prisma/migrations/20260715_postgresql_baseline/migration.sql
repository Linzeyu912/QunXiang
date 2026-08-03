-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "emailNormalized" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "shareCodeHash" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Book" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'text/plain',
    "status" TEXT NOT NULL DEFAULT 'UPLOADED',
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Book_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Character" (
    "id" UUID NOT NULL,
    "bookId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "aliases" JSONB NOT NULL DEFAULT '[]',
    "description" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "chapterRef" TEXT,
    "firstChapter" INTEGER,
    "lastChapter" INTEGER,
    "chapterAppearances" JSONB NOT NULL DEFAULT '[]',
    "mentionCount" INTEGER NOT NULL DEFAULT 0,
    "dialogueCount" INTEGER NOT NULL DEFAULT 0,
    "coCharacters" JSONB NOT NULL DEFAULT '[]',
    "outfits" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Character_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" UUID NOT NULL,
    "bookId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "aliases" JSONB NOT NULL DEFAULT '[]',
    "description" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "chapterRef" TEXT,
    "importanceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tier" TEXT NOT NULL DEFAULT 'candidate',
    "storyScore" INTEGER NOT NULL DEFAULT 0,
    "productionScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pillarCausal" INTEGER NOT NULL DEFAULT 0,
    "pillarUniqueness" INTEGER NOT NULL DEFAULT 0,
    "pillarTransition" INTEGER NOT NULL DEFAULT 0,
    "mentionCount" INTEGER NOT NULL DEFAULT 0,
    "firstChapter" INTEGER,
    "lastChapter" INTEGER,
    "chapterAppearances" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Item" (
    "id" UUID NOT NULL,
    "bookId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "aliases" JSONB NOT NULL DEFAULT '[]',
    "description" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "chapterRef" TEXT,
    "importanceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tier" TEXT NOT NULL DEFAULT 'candidate',
    "storyScore" INTEGER NOT NULL DEFAULT 0,
    "productionScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pillarCausal" INTEGER NOT NULL DEFAULT 0,
    "pillarUniqueness" INTEGER NOT NULL DEFAULT 0,
    "pillarTransition" INTEGER NOT NULL DEFAULT 0,
    "mentionCount" INTEGER NOT NULL DEFAULT 0,
    "firstChapter" INTEGER,
    "lastChapter" INTEGER,
    "chapterAppearances" JSONB NOT NULL DEFAULT '[]',
    "owners" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CharacterReview" (
    "id" UUID NOT NULL,
    "characterId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "previousValue" TEXT,
    "newValue" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CharacterReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtractionSession" (
    "id" UUID NOT NULL,
    "bookId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "ExtractionSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" UUID NOT NULL,
    "bookId" UUID NOT NULL,
    "agentType" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "result" JSONB,
    "error" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "deadLettered" BOOLEAN NOT NULL DEFAULT false,
    "failedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NoiseOverride" (
    "id" UUID NOT NULL,
    "bookId" UUID NOT NULL,
    "lineNum" INTEGER NOT NULL,
    "action" TEXT NOT NULL DEFAULT 'keep',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "NoiseOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntityImage" (
    "id" UUID NOT NULL,
    "bookId" UUID NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "ext" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "aspectRatio" TEXT,
    "source" TEXT NOT NULL DEFAULT 'generated',
    "stage" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EntityImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshSession" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "familyId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "rotatedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackgroundJob" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "uniqueKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "payload" JSONB NOT NULL,
    "result" JSONB,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMPTZ(3),
    "nextRunAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "BackgroundJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_emailNormalized_key" ON "User"("emailNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "User_shareCodeHash_key" ON "User"("shareCodeHash");

-- CreateIndex
CREATE INDEX "Book_userId_idx" ON "Book"("userId");

-- CreateIndex
CREATE INDEX "Character_bookId_idx" ON "Character"("bookId");

-- CreateIndex
CREATE INDEX "Location_bookId_idx" ON "Location"("bookId");

-- CreateIndex
CREATE INDEX "Location_tier_idx" ON "Location"("tier");

-- CreateIndex
CREATE INDEX "Item_bookId_idx" ON "Item"("bookId");

-- CreateIndex
CREATE INDEX "Item_tier_idx" ON "Item"("tier");

-- CreateIndex
CREATE INDEX "Task_status_idx" ON "Task"("status");

-- CreateIndex
CREATE INDEX "Task_agentType_idx" ON "Task"("agentType");

-- CreateIndex
CREATE INDEX "Task_bookId_idx" ON "Task"("bookId");

-- CreateIndex
CREATE INDEX "NoiseOverride_bookId_idx" ON "NoiseOverride"("bookId");

-- CreateIndex
CREATE UNIQUE INDEX "NoiseOverride_bookId_lineNum_key" ON "NoiseOverride"("bookId", "lineNum");

-- CreateIndex
CREATE INDEX "EntityImage_bookId_entityType_entityName_idx" ON "EntityImage"("bookId", "entityType", "entityName");

-- CreateIndex
CREATE INDEX "EntityImage_bookId_idx" ON "EntityImage"("bookId");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshSession_tokenHash_key" ON "RefreshSession"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshSession_userId_idx" ON "RefreshSession"("userId");

-- CreateIndex
CREATE INDEX "RefreshSession_familyId_idx" ON "RefreshSession"("familyId");

-- CreateIndex
CREATE UNIQUE INDEX "BackgroundJob_uniqueKey_key" ON "BackgroundJob"("uniqueKey");

-- CreateIndex
CREATE INDEX "BackgroundJob_status_nextRunAt_idx" ON "BackgroundJob"("status", "nextRunAt");

-- CreateIndex
CREATE INDEX "BackgroundJob_leaseExpiresAt_idx" ON "BackgroundJob"("leaseExpiresAt");

-- CreateIndex
CREATE INDEX "AuditLog_targetType_targetId_createdAt_idx" ON "AuditLog"("targetType", "targetId", "createdAt");

-- AddForeignKey
ALTER TABLE "Book" ADD CONSTRAINT "Book_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Character" ADD CONSTRAINT "Character_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterReview" ADD CONSTRAINT "CharacterReview_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterReview" ADD CONSTRAINT "CharacterReview_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractionSession" ADD CONSTRAINT "ExtractionSession_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractionSession" ADD CONSTRAINT "ExtractionSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoiseOverride" ADD CONSTRAINT "NoiseOverride_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityImage" ADD CONSTRAINT "EntityImage_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshSession" ADD CONSTRAINT "RefreshSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddCheckConstraint
ALTER TABLE "User"
  ADD CONSTRAINT "User_status_check"
  CHECK ("status" IN ('ACTIVE', 'DISABLED'));

-- AddCheckConstraint
ALTER TABLE "BackgroundJob"
  ADD CONSTRAINT "BackgroundJob_status_check"
  CHECK ("status" IN ('pending', 'running', 'succeeded', 'failed'));
