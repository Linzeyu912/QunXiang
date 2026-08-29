-- 低置信度库证据片段：首次出现处的原文片段（前后各约30字），
-- 供人工判断"这是真角色还是误提"时参考。三类实体均加可空列，无回填。
ALTER TABLE "Character" ADD COLUMN "firstMentionSnippet" TEXT;
ALTER TABLE "Location" ADD COLUMN "firstMentionSnippet" TEXT;
ALTER TABLE "Item" ADD COLUMN "firstMentionSnippet" TEXT;
