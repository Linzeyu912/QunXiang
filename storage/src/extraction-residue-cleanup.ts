import type { PrismaClient } from '@prisma/client';

export interface ResidueCleanupResult {
  /** 每个变体保留最新 version 后删除的旧 VisualSpec 行数 */
  supersededSpecs: number;
  /** 物理删除的归档实体数（archivedAt 非空的四类实体） */
  archivedEntities: number;
  /** 随归档实体删除的孤儿图片记录数（按名字软关联的 EntityImage） */
  orphanImages: number;
}

export interface ResidueCleanupOptions {
  /** 只统计不删除，用于执行前预览 */
  dryRun?: boolean;
}

type EntityDelegate = {
  findMany(args: unknown): Promise<Array<Record<string, unknown>>>;
  deleteMany(args: unknown): Promise<{ count: number }>;
};

const ENTITY_MODELS = ['character', 'location', 'item', 'worldviewSetting'] as const;

/**
 * 提取重跑残留清理：
 * - VisualSpec 每个（书、实体、变体）只保留最新 version（重跑只 SUPERSEDE 不删历史的
 *   设计让表逐轮膨胀；最新版之外的旧 version 对查询不可见，可安全删除）
 * - 归档实体（archivedAt 非空，纯 AI 且已被新一轮替换）物理删除。
 *   注意：missingFromLatestRun=true 但未归档的实体是"人工审核过、新结果未提及"的
 *   特意保留项，不在清理范围；EntityReview 审核历史为独立表，不受影响。
 * - 归档实体按名字软关联的 EntityImage 一并删除（否则成孤儿记录）。
 *
 * 既可全书清理（脚本），也可单书清理（每轮入库完成后自动调用，防逐轮累积）。
 */
export function createExtractionResidueCleanup(db: PrismaClient) {
  return {
    async cleanup(bookId: string | null, options: ResidueCleanupOptions = {}): Promise<ResidueCleanupResult> {
      const dryRun = options.dryRun === true;
      const specWhere = bookId ? { where: { bookId } } : {};

      // 1. VisualSpec：分组保留最新 version
      const specs = (await db.visualSpec.findMany({
        ...specWhere,
        select: { id: true, bookId: true, entityType: true, entityName: true, variantKey: true, version: true },
      })) as Array<{ id: string; bookId: string; entityType: string; entityName: string; variantKey: string; version: number }>;
      const latestIds = new Set<string>();
      const byVariant = new Map<string, { id: string; version: number }>();
      for (const spec of specs) {
        const key = `${spec.bookId}|${spec.entityType}|${spec.entityName}|${spec.variantKey}`;
        const current = byVariant.get(key);
        if (!current || spec.version > current.version) {
          if (current) latestIds.delete(current.id);
          byVariant.set(key, { id: spec.id, version: spec.version });
          latestIds.add(spec.id);
        }
      }
      const staleSpecIds = specs.filter((s) => !latestIds.has(s.id)).map((s) => s.id);
      let supersededSpecs = 0;
      if (!dryRun && staleSpecIds.length > 0) {
        // 分批删除（IN 列表过大时 PostgreSQL 参数上限 32767）
        for (let i = 0; i < staleSpecIds.length; i += 1000) {
          const chunk = staleSpecIds.slice(i, i + 1000);
          const res = await db.visualSpec.deleteMany({ where: { id: { in: chunk } } });
          supersededSpecs += res.count;
        }
      } else {
        supersededSpecs = staleSpecIds.length;
      }

      // 2. 归档实体 + 其软关联图片
      let archivedEntities = 0;
      let orphanImages = 0;
      for (const model of ENTITY_MODELS) {
        const delegate = (db as unknown as Record<(typeof ENTITY_MODELS)[number], EntityDelegate>)[model];
        const archived = await delegate.findMany({
          where: { ...(bookId ? { bookId } : {}), archivedAt: { not: null } },
        });
        if (archived.length === 0) continue;
        if (dryRun) {
          archivedEntities += archived.length;
          continue;
        }
        const names = archived.map((row) => String(row.name));
        // 先删按名字软关联的图片（EntityImage 无 FK，需显式清理）
        const imgRes = await db.entityImage.deleteMany({
          where: {
            ...(bookId ? { bookId } : {}),
            entityType: model === 'worldviewSetting' ? 'worldview' : model,
            entityName: { in: names },
          },
        });
        orphanImages += imgRes.count;
        const delRes = await delegate.deleteMany({
          where: { id: { in: archived.map((row) => String(row.id)) } },
        });
        archivedEntities += delRes.count;
      }

      return { supersededSpecs, archivedEntities, orphanImages };
    },
  };
}

export type ExtractionResidueCleanup = ReturnType<typeof createExtractionResidueCleanup>;
