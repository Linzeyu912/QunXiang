-- 存量书籍回填：视为已确认当前版本（兼容周期内不阻塞既有用户的重新提取）
UPDATE "Book" SET "preprocessConfirmedRevision" = "sourceRevision" WHERE "preprocessConfirmedRevision" IS NULL;
