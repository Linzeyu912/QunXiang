/**
 * 提取重跑残留清理（维护脚本）：
 *   pnpm --filter @qunxiang/storage db:cleanup-residue -- --dry-run   # 预览全部书
 *   pnpm --filter @qunxiang/storage db:cleanup-residue                # 执行全部书
 *   pnpm --filter @qunxiang/storage db:cleanup-residue -- --book=<id> # 只清一本书
 *
 * 清理内容与保护规则见 src/extraction-residue-cleanup.ts：
 * 旧 version VisualSpec、归档实体（纯 AI 被替换）及其孤儿图片；
 * 人工审核保留项（missingFromLatestRun 未归档）与审核历史不受影响。
 */
import { prisma } from '../src/prisma.js';
import { createExtractionResidueCleanup } from '../src/extraction-residue-cleanup.js';

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const bookArg = args.find((a) => a.startsWith('--book='));
  const bookId = bookArg ? bookArg.slice('--book='.length) : null;

  if (bookId) {
    const book = await prisma.book.findUnique({ where: { id: bookId }, select: { title: true } });
    if (!book) {
      console.error(`书籍不存在：${bookId}`);
      process.exit(1);
    }
    console.log(`目标书籍：《${book.title}》（${bookId}）`);
  } else {
    const count = await prisma.book.count();
    console.log(`目标：全部书籍（${count} 本）`);
  }
  console.log(dryRun ? '【预览模式】只统计不删除\n' : '');

  const cleanup = createExtractionResidueCleanup(prisma);
  const t0 = Date.now();
  const result = await cleanup.cleanup(bookId, { dryRun });

  console.log(dryRun ? '将清理：' : '已清理：');
  console.log(`  旧版本视觉设定（VisualSpec）：${result.supersededSpecs} 行`);
  console.log(`  归档实体：${result.archivedEntities} 个`);
  console.log(`  归档实体孤儿图片记录：${result.orphanImages} 条`);
  console.log(`耗时 ${Date.now() - t0}ms`);
  if (dryRun) {
    console.log('\n确认无误后去掉 --dry-run 执行实际删除。');
  }
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error('清理失败：', error instanceof Error ? error.message : String(error));
  await prisma.$disconnect();
  process.exit(1);
});
