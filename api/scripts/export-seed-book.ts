/**
 * 公共书库打包工具：把一本"做好的书"（提取+审核+生图完成）从当前 DB/对象存储
 * 导出为仓库内 seed-library/<slug>/ 书包，随 git 分发给新部署用户。
 *
 * 用法：pnpm --filter @qunxiang/api seed:export <bookId> <slug>
 *
 * 导出内容（格式与 library-seed.service.ts 的物化器一一对应）：
 *   manifest.json / source.txt(UTF-8) / entities.json / run-summary.json /
 *   artifacts/entities/* / images/index.json + 图片字节
 */
import 'dotenv/config';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  closeDatabase,
  prisma,
  getSharedObjectStore,
  CharacterRepository,
  LocationRepository,
  ItemRepository,
  WorldviewRepository,
  EntityImageRepository,
  readBookArtifactText,
} from '@qunxiang/storage';
import { decodeText } from '@qunxiang/import';
import { PROJECT_ROOT } from '../src/lib/paths.js';

const ARTIFACT_FILES = [
  'character-descriptions.json',
  'character-visual-descriptions.json',
  'character-prompts.json',
  'location-descriptions.json',
  'location-visual-descriptions.json',
  'location-prompts.json',
  'item-descriptions.json',
  'item-visual-descriptions.json',
  'item-prompts.json',
  'events.json',
  'summary.md',
  'all-prompts.md',
] as const;
const ROOT_ARTIFACT_FILES = ['worldview-synthesis.json'] as const;

const SIZE_WARN_BYTES = 50 * 1024 * 1024; // repo 体积软上限 50MB

/** 剥掉物化时不需要的字段；status 也剥掉（物化统一 APPROVED，下方有未审核警告）。 */
function stripRow<T extends Record<string, unknown>>(row: T): Record<string, unknown> {
  const { id: _id, bookId: _b, createdAt: _c, updatedAt: _u, status: _s, reviews: _r, ...rest } = row;
  return rest;
}

/** 在 output/ 与 api/output/ 两个根下找该书最新 official run 目录名。 */
async function findLatestRunDir(bookId: string): Promise<string | null> {
  const roots = [resolve(PROJECT_ROOT, 'output'), resolve(PROJECT_ROOT, 'api', 'output')];
  let best: { dir: string; root: string; generatedAt: string } | null = null;
  for (const root of roots) {
    let entries: string[] = [];
    try {
      entries = await readdir(root);
    } catch {
      continue;
    }
    for (const entry of entries) {
      try {
        const summary = JSON.parse(
          await readFile(join(root, entry, 'final', 'run-summary.json'), 'utf-8'),
        ) as { bookId?: string; officialResult?: boolean; generatedAt?: string };
        if (summary.bookId !== bookId || summary.officialResult === false) continue;
        const generatedAt = summary.generatedAt ?? '';
        if (!best || generatedAt > best.generatedAt) best = { dir: entry, root, generatedAt };
      } catch {
        // 非 run 目录或 summary 缺失，跳过
      }
    }
  }
  return best ? join(best.root, best.dir) : null;
}

async function main() {
  const [bookId, slug] = process.argv.slice(2);
  if (!bookId || !slug) {
    console.error('用法：pnpm --filter @qunxiang/api seed:export <bookId> <slug>');
    process.exitCode = 1;
    return;
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    console.error('slug 只能包含小写字母/数字/连字符');
    process.exitCode = 1;
    return;
  }

  const book = await prisma.book.findUnique({ where: { id: bookId } });
  if (!book) {
    console.error(`书籍不存在：${bookId}`);
    process.exitCode = 1;
    return;
  }

  const outDir = resolve(PROJECT_ROOT, 'seed-library', slug);
  await mkdir(join(outDir, 'artifacts', 'entities'), { recursive: true });
  await mkdir(join(outDir, 'images'), { recursive: true });

  const store = getSharedObjectStore();
  let totalBytes = 0;

  // ── 原文（统一 UTF-8 写出）──
  let sourceBuf: Buffer;
  if (book.sourceObjectKey) {
    sourceBuf = Buffer.from((await store.get(book.sourceObjectKey)).bytes);
  } else {
    sourceBuf = await readFile(book.filePath);
  }
  const sourceText = decodeText(sourceBuf); // 验证可解码并归一化
  await writeFile(join(outDir, 'source.txt'), sourceText, 'utf-8');
  totalBytes += Buffer.byteLength(sourceText, 'utf-8');

  // ── 实体（角色、场景、道具、世界观）──
  const [characters, locations, items, worldviews] = await Promise.all([
    CharacterRepository.findByBookId(bookId),
    LocationRepository.findByBookId(bookId),
    ItemRepository.findByBookId(bookId),
    WorldviewRepository.findByBookId(bookId),
  ]);
  const allRows = [...characters, ...locations, ...items, ...worldviews] as unknown as {
    name: string; status: string;
  }[];
  const notApproved = allRows.filter((r) => r.status !== 'APPROVED');
  if (notApproved.length > 0) {
    console.warn(
      `⚠ 有 ${notApproved.length} 个实体未审核通过（如 ${notApproved.slice(0, 3).map((r) => r.name).join('、')}），` +
      '物化时会统一标为 APPROVED。建议先审核再导出。',
    );
  }
  const entitiesJson = JSON.stringify(
    {
      characters: characters.map((r) => stripRow(r as unknown as Record<string, unknown>)),
      locations: locations.map((r) => stripRow(r as unknown as Record<string, unknown>)),
      items: items.map((r) => stripRow(r as unknown as Record<string, unknown>)),
      worldviews: worldviews.map((r) => stripRow(r as unknown as Record<string, unknown>)),
    },
    null,
    2,
  );
  await writeFile(join(outDir, 'entities.json'), entitiesJson, 'utf-8');

  // ── run-summary + artifacts（优先 BookArtifact，回退本机 run 目录）──
  const runDir = await findLatestRunDir(bookId);
  let runSummaryText = await readBookArtifactText(bookId, 'run-summary.json');
  if (!runSummaryText && runDir) {
    runSummaryText = await readFile(join(runDir, 'final', 'run-summary.json'), 'utf-8').catch(() => null);
  }
  if (!runSummaryText) {
    console.warn('⚠ 未找到 run-summary.json（BookArtifact 与 output/ 均无），产物区将不可用。');
  } else {
    await writeFile(join(outDir, 'run-summary.json'), runSummaryText, 'utf-8');
  }

  // 根级结构化产物不属于某次提取运行，单独随书包导出。
  for (const file of ROOT_ARTIFACT_FILES) {
    const text = await readBookArtifactText(bookId, file);
    if (text) await writeFile(join(outDir, file), text, 'utf-8');
  }

  let artifactCount = 0;
  for (const file of ARTIFACT_FILES) {
    let text = await readBookArtifactText(bookId, `entities/${file}`);
    if (!text && runDir) {
      text = await readFile(join(runDir, 'entities', file), 'utf-8').catch(() => null);
    }
    if (!text) continue;
    await writeFile(join(outDir, 'artifacts', 'entities', file), text, 'utf-8');
    artifactCount++;
  }

  // ── 图片 ──
  const imageRows = await EntityImageRepository.findByBookId(bookId);
  const index: Record<string, unknown>[] = [];
  const primaryByEntity = new Map<string, number>();
  for (let i = 0; i < imageRows.length; i++) {
    const row = imageRows[i];
    let body: Buffer;
    if (row.objectKey) {
      body = Buffer.from((await store.get(row.objectKey)).bytes);
    } else {
      body = await readFile(row.filePath);
    }
    const fileName = `${i}${row.ext.startsWith('.') ? row.ext : `.${row.ext}`}`;
    await writeFile(join(outDir, 'images', fileName), body);
    totalBytes += body.length;
    const key = `${row.entityType}/${row.entityName}`;
    if (row.isPrimary) primaryByEntity.set(key, (primaryByEntity.get(key) ?? 0) + 1);
    index.push({
      entityType: row.entityType,
      entityName: row.entityName,
      file: `images/${fileName}`,
      mime: row.mime,
      ext: row.ext,
      bytes: row.bytes,
      aspectRatio: row.aspectRatio,
      source: row.source,
      stage: row.stage,
      isPrimary: row.isPrimary,
      sortOrder: row.sortOrder,
    });
  }
  const badPrimary = [...primaryByEntity.entries()].filter(([, n]) => n !== 1);
  if (badPrimary.length > 0) {
    console.warn(`⚠ ${badPrimary.length} 个实体的主图数量不为 1（${badPrimary.slice(0, 3).map(([k]) => k).join('、')}）`);
  }
  await writeFile(join(outDir, 'images', 'index.json'), JSON.stringify(index, null, 2), 'utf-8');

  // ── manifest ──
  const manifest = {
    slug,
    title: book.title,
    version: 1,
    exportedAt: new Date().toISOString(),
    sourceFile: 'source.txt',
    fileSize: Buffer.byteLength(sourceText, 'utf-8'),
    counts: {
      characters: characters.length,
      locations: locations.length,
      items: items.length,
      worldviews: worldviews.length,
      images: imageRows.length,
    },
  };
  await writeFile(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');

  const mb = (totalBytes / 1024 / 1024).toFixed(1);
  console.log(
    `✓ 导出完成：seed-library/${slug}/（角色 ${characters.length} / 场景 ${locations.length} / ` +
    `道具 ${items.length} / 世界观 ${worldviews.length} / 图片 ${imageRows.length} / ` +
    `产物 ${artifactCount}/${ARTIFACT_FILES.length}，共 ${mb} MB）`,
  );
  if (totalBytes > SIZE_WARN_BYTES) {
    console.warn(`⚠ 书包体积 ${mb} MB 超过 50MB 软上限，注意 git 仓库膨胀。`);
  }
}

main()
  .catch((error) => {
    console.error('导出失败：', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase();
  });
