-- Phase 8: 道具大类划分（weapon/skill/food/pill/treasure/other，默认 other）

ALTER TABLE "Item" ADD COLUMN "category" TEXT NOT NULL DEFAULT 'other';

CREATE INDEX "Item_bookId_category_idx" ON "Item"("bookId", "category");
