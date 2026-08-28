-- 后端性能索引（2026-08-28 等价优化批次 E）
-- 依据（嵌入式 PostgreSQL 15/18 测试库，EXPLAIN ANALYZE 前后对比）：
--
-- 1) CharacterReview 此前无任何索引。以下查询均为顺序扫描：
--    - collector 快照收集逐角色查询（api/src/snapshot/collector.ts 的 reviewBuckets）；
--    - ReviewRepository.findByCharacterId / findOwnedByCharacterId；
--    - 角色合并判断 hasMergeRejection（character.repository.ts）。
--    2 万行时单次查询过滤掉 19500 行并额外排序（0.898ms、229 缓冲）。
--    (characterId, createdAt) 复合索引同时覆盖过滤与 createdAt DESC 排序。
--
-- 2) Task.claimNext 是 worker 轮询热路径（每 1~5 秒 × worker 数执行）：
--    WHERE agentType='extractor' AND status='pending' ORDER BY createdAt ASC LIMIT 1
--    此前仅有单列 (status)/(agentType) 索引，计划为顺序扫描 + 全量排序
--    （5000 行 0.636ms、72 缓冲）。(agentType, status, createdAt) 复合索引
--    让该查询变为索引序 limit 1 读取。

CREATE INDEX "CharacterReview_characterId_createdAt_idx" ON "CharacterReview"("characterId", "createdAt");

CREATE INDEX "Task_agentType_status_createdAt_idx" ON "Task"("agentType", "status", "createdAt");
