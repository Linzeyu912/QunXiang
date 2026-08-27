/**
 * 存量道具大类回填：把历史上落在 other 的道具按「名称 + 描述」重新推断分类。
 *
 * 背景：道具大类功能（2026-08 中旬）上线前的提取没有 category，
 * 旧运行又可能因旧进程/旧代码成片落 other。新提取已在管道内兜底
 * （extractor 去重 + 入库映射双重推断），本脚本只修复存量数据，
 * 与管道共用 @qunxiang/core 的 inferItemCategory，关键词表单一来源。
 *
 * 用法（在 storage 包内执行）：
 *   pnpm db:backfill-item-categories            # 实际回填
 *   pnpm db:backfill-item-categories --dry-run  # 只预览不写库
 *
 * 只把 other 改判为具体类别，不覆盖已是具体类别的行；可安全重复执行。
 */

import { PrismaClient } from '@prisma/client';
import { inferItemCategory } from '@qunxiang/core';

const prisma = new PrismaClient();
const dryRun = process.argv.includes('--dry-run');

async function main() {
  console.log(dryRun ? '[预览模式] 不写库，仅统计' : '[回填模式] 将更新数据库');

  const items = await prisma.item.findMany({
    where: { category: 'other' },
    select: { id: true, name: true, description: true },
  });
  console.log(`category=other 的道具共 ${items.length} 个`);

  const stats: Record<string, number> = { weapon: 0, skill: 0, food: 0, pill: 0, treasure: 0, unchanged: 0 };
  const samples: string[] = [];

  for (const item of items) {
    const inferred = inferItemCategory(item.name, item.description ?? undefined);
    if (inferred === 'other') {
      stats.unchanged++;
      continue;
    }
    stats[inferred]++;
    if (samples.length < 30) samples.push(`${item.name} -> ${inferred}`);
    if (!dryRun) {
      await prisma.item.update({ where: { id: item.id }, data: { category: inferred } });
    }
  }

  console.log('改判统计（unchanged = 仍判不出，保持 other）:');
  console.table(stats);
  console.log('抽样（前 30 条）:');
  samples.forEach((s) => console.log(`  ${s}`));
}

main()
  .catch((e) => {
    console.error('回填失败：', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
