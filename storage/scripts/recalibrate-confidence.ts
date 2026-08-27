/**
 * 存量数据置信度回填：把旧数据里未经校准的 LLM 自报置信度，
 * 用库里已有的证据字段（提及次数/出现章节/对话次数）重新校准。
 *
 * 背景：校准逻辑（calibrateConfidence）上线前，落库的置信度直接取
 * LLM 自报值（普遍 0.85+），导致低置信度库长期为空。新提取的数据
 * 已在管道内校准，本脚本只用于修复旧数据，让旧书也能正确分流。
 *
 * 用法（在 storage 包内执行）：
 *   pnpm db:recalibrate-confidence            # 实际回填
 *   pnpm db:recalibrate-confidence --dry-run  # 只预览不写库
 *
 * ⚠️ 本脚本为一次性维护脚本：重复执行会把已校准的值再次当作
 * 「自报先验」压低置信度。只在旧数据上运行一次。
 */

import { PrismaClient } from '@prisma/client';
import { calibrateConfidence, isLowConfidenceEntity, type ConfidenceEvidence } from '@qunxiang/core';

const prisma = new PrismaClient();
const dryRun = process.argv.includes('--dry-run');

/** chapterAppearances 在 Prisma 里是 Json 类型，运行时校验后取数组长度 */
function chapterCount(v: unknown): number {
  return Array.isArray(v) ? v.length : 0;
}

interface RowLike {
  id: string;
  confidence: number;
  status: string;
}

/** 统计并（非预览模式下）回填一行，返回是否发生了变更 */
async function applyRow(
  row: RowLike & { mentionCount?: number | null },
  evidence: ConfidenceEvidence,
  update: (id: string, confidence: number) => Promise<unknown>,
  stat: { total: number; changed: number; lowAfter: number },
): Promise<void> {
  const next = calibrateConfidence(row.confidence, evidence);
  stat.total++;
  // 与 isLowConfidenceEntity 同口径：仅待审核的低置信度实体会出现在库中
  if (isLowConfidenceEntity({ confidence: next, status: row.status })) stat.lowAfter++;
  if (Math.abs(next - row.confidence) >= 0.001) {
    stat.changed++;
    if (!dryRun) await update(row.id, next);
  }
}

async function main() {
  console.log(dryRun ? '[预览模式] 不写库，仅统计' : '[回填模式] 将更新数据库');

  const stats: Record<string, { total: number; changed: number; lowAfter: number }> = {
    character: { total: 0, changed: 0, lowAfter: 0 },
    location: { total: 0, changed: 0, lowAfter: 0 },
    item: { total: 0, changed: 0, lowAfter: 0 },
    worldview: { total: 0, changed: 0, lowAfter: 0 },
  };

  // 角色：证据含对话次数
  const characters = await prisma.character.findMany({
    select: { id: true, confidence: true, mentionCount: true, dialogueCount: true, chapterAppearances: true, status: true },
  });
  for (const c of characters) {
    await applyRow(
      c,
      {
        mentionCount: c.mentionCount || 0,
        chapterCount: chapterCount(c.chapterAppearances),
        dialogueCount: c.dialogueCount || 0,
      },
      (id, confidence) => prisma.character.update({ where: { id }, data: { confidence } }).then(() => undefined),
      stats.character,
    );
  }

  // 场景/道具：证据不含对话
  const locations = await prisma.location.findMany({
    select: { id: true, confidence: true, mentionCount: true, chapterAppearances: true, status: true },
  });
  for (const r of locations) {
    await applyRow(
      r,
      { mentionCount: r.mentionCount || 0, chapterCount: chapterCount(r.chapterAppearances) },
      (id, confidence) => prisma.location.update({ where: { id }, data: { confidence } }).then(() => undefined),
      stats.location,
    );
  }

  const items = await prisma.item.findMany({
    select: { id: true, confidence: true, mentionCount: true, chapterAppearances: true, status: true },
  });
  for (const r of items) {
    await applyRow(
      r,
      { mentionCount: r.mentionCount || 0, chapterCount: chapterCount(r.chapterAppearances) },
      (id, confidence) => prisma.item.update({ where: { id }, data: { confidence } }).then(() => undefined),
      stats.item,
    );
  }

  // 世界观：无独立提及计数，用章节证据数近似（列表不过滤低置信度，仅统一口径）
  const worldviews = await prisma.worldviewSetting.findMany({
    select: { id: true, confidence: true, chapterAppearances: true, status: true },
  });
  for (const w of worldviews) {
    const chapters = chapterCount(w.chapterAppearances);
    await applyRow(
      { id: w.id, confidence: w.confidence, status: w.status },
      { mentionCount: chapters, chapterCount: chapters },
      (id, confidence) => prisma.worldviewSetting.update({ where: { id }, data: { confidence } }).then(() => undefined),
      stats.worldview,
    );
  }

  console.table(stats);
  console.log('说明：lowAfter = 校准后置信度低于 0.6 且未人工通过的条数（即会出现在低置信度库的数量，世界观不在库中展示）。');
}

main()
  .catch((e) => {
    console.error('回填失败：', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
