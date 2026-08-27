/**
 * 统一统计口径（实施包 G1/G2）。
 *
 * 主数量 = 当前数据库中未归档的有效实体（MAIN 集合）；
 * 低置信度待确认单独统计；已拒绝不计入有效数量；原始候选仅作说明。
 * 书籍页面、低置信度入口、导出清单与快照共用本服务。
 */
import {
  CharacterRepository,
  LocationRepository,
  ItemRepository,
  WorldviewRepository,
  prisma,
} from '@qunxiang/storage';
import type { ReviewBucketCounts } from '@qunxiang/storage';

export interface EntityTypeStats {
  main: number;
  lowConfidence: number;
  rejected: number;
}

export interface BookEntityStats {
  byType: Record<'character' | 'location' | 'item' | 'worldview', EntityTypeStats>;
  totals: EntityTypeStats;
  /** 审核来源统计（未归档实体） */
  reviewSource: { AI: number; IMPORTED: number; USER: number };
  /** 实体图片数 */
  imageCount: number;
  /** 最新一轮提取未再出现、但人工审核过而保留的实体数（风险提示） */
  missingFromLatestRun: number;
}

export async function getBookEntityStats(bookId: string, ownerId: string): Promise<BookEntityStats> {
  const [charCounts, locCounts, itemCounts, wvCounts, reviewSourceRows, imageCount, missingRows] = await Promise.all([
    CharacterRepository.countReviewBuckets(bookId, ownerId),
    LocationRepository.countReviewBuckets(bookId, ownerId),
    ItemRepository.countReviewBuckets(bookId, ownerId),
    WorldviewRepository.countReviewBuckets(bookId, ownerId),
    prisma.$queryRaw<Array<{ reviewSource: string; count: bigint }>>`
      SELECT "reviewSource", COUNT(*)::bigint AS count FROM (
        SELECT "reviewSource", "archivedAt" FROM "Character" WHERE "bookId" = ${bookId}::uuid
        UNION ALL
        SELECT "reviewSource", "archivedAt" FROM "Location" WHERE "bookId" = ${bookId}::uuid
        UNION ALL
        SELECT "reviewSource", "archivedAt" FROM "Item" WHERE "bookId" = ${bookId}::uuid
        UNION ALL
        SELECT "reviewSource", "archivedAt" FROM "WorldviewSetting" WHERE "bookId" = ${bookId}::uuid
      ) t
      WHERE t."archivedAt" IS NULL
      GROUP BY "reviewSource"
    `,
    prisma.entityImage.count({ where: { bookId } }),
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count FROM (
        SELECT "missingFromLatestRun", "archivedAt" FROM "Character" WHERE "bookId" = ${bookId}::uuid
        UNION ALL
        SELECT "missingFromLatestRun", "archivedAt" FROM "Location" WHERE "bookId" = ${bookId}::uuid
        UNION ALL
        SELECT "missingFromLatestRun", "archivedAt" FROM "Item" WHERE "bookId" = ${bookId}::uuid
        UNION ALL
        SELECT "missingFromLatestRun", "archivedAt" FROM "WorldviewSetting" WHERE "bookId" = ${bookId}::uuid
      ) t
      WHERE t."missingFromLatestRun" = TRUE AND t."archivedAt" IS NULL
    `,
  ]);

  const pick = (c: ReviewBucketCounts): EntityTypeStats => ({
    main: c.MAIN, lowConfidence: c.LOW_CONFIDENCE, rejected: c.REJECTED,
  });
  const byType = {
    character: pick(charCounts),
    location: pick(locCounts),
    item: pick(itemCounts),
    worldview: pick(wvCounts),
  };
  const totals = (Object.values(byType) as EntityTypeStats[]).reduce(
    (acc, s) => ({
      main: acc.main + s.main,
      lowConfidence: acc.lowConfidence + s.lowConfidence,
      rejected: acc.rejected + s.rejected,
    }),
    { main: 0, lowConfidence: 0, rejected: 0 },
  );
  const reviewSource = { AI: 0, IMPORTED: 0, USER: 0 };
  for (const row of reviewSourceRows) {
    const key = row.reviewSource as keyof typeof reviewSource;
    if (key in reviewSource) reviewSource[key] = Number(row.count);
  }

  return {
    byType,
    totals,
    reviewSource,
    imageCount,
    missingFromLatestRun: Number(missingRows[0]?.count ?? 0),
  };
}

export interface ExportManifest {
  bookId: string;
  bookTitle: string;
  /** 原文版本 */
  sourceRevision: number;
  /** 最近成功发布的提取运行 */
  currentExtractionSessionId: string | null;
  /** 产物是否基于旧版原文 */
  artifactsOutdated: boolean;
  stats: BookEntityStats;
  /** 缺失的关键产物（提示补生成） */
  missingArtifacts: string[];
  /** 风险警告（中文） */
  warnings: string[];
}

/** 导出清单（实施包 G2）。 */
export async function getExportManifest(bookId: string, ownerId: string): Promise<ExportManifest | null> {
  const book = await prisma.book.findFirst({ where: { id: bookId, userId: ownerId } });
  if (!book) return null;

  const stats = await getBookEntityStats(bookId, ownerId);
  const artifacts = await prisma.bookArtifact.findMany({ where: { bookId } });
  const stamped = artifacts.filter((a) => a.sourceRevision !== null);
  const basedOn = stamped.length > 0 ? stamped[0].sourceRevision : undefined;
  const artifactsOutdated = basedOn !== undefined && basedOn !== book.sourceRevision;

  const missingArtifacts: string[] = [];
  if (!artifacts.some((a) => a.logicalPath === 'run-summary.json')) missingArtifacts.push('run-summary.json（运行摘要）');
  if (!artifacts.some((a) => a.category === 'preprocess')) missingArtifacts.push('preprocess/*（版本化预处理产物，可在章节页确认版本时生成）');

  const warnings: string[] = [];
  if (artifactsOutdated) warnings.push('部分产物基于旧版原文生成，建议确认版本后重新提取');
  if (stats.missingFromLatestRun > 0) warnings.push(`${stats.missingFromLatestRun} 个实体在最新一轮提取中未再出现（人工审核过已保留），请复核`);
  if (stats.totals.lowConfidence > 0) warnings.push(`${stats.totals.lowConfidence} 个低置信度实体待确认，未计入有效数量`);
  if (!book.currentExtractionSessionId) warnings.push('该书没有成功发布的提取运行（可能是导入结果或尚未提取）');

  return {
    bookId,
    bookTitle: book.title,
    sourceRevision: book.sourceRevision,
    currentExtractionSessionId: book.currentExtractionSessionId,
    artifactsOutdated,
    stats,
    missingArtifacts,
    warnings,
  };
}
