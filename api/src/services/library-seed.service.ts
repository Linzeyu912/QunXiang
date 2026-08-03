/**
 * 公共书库（预置书籍）：新用户注册时把仓库内 seed-library/ 的书包物化到其名下。
 *
 * 设计要点（见计划与源码核实）：
 * - seed 数据以文件形式随仓库分发（seed-library/<slug>/），不走"系统用户持有模板书"
 *   ——startup-account-safety.test.ts 明确禁止启动时创建系统账号。
 * - 物化是 DB 行级深拷贝（Book + Character/Location/Item + EntityImage + BookArtifact），
 *   不复用分享复制（book-copy.ts 只搬快照引用，副本在审核页是空的）。
 * - 对象存储内容寻址：N 个用户注册，同字节只存一份；DB 行各自独立，互不影响。
 * - 失败不阻断注册：调用方（auth.ts）try/catch；单书包失败只记日志继续下一本。
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { prisma, getSharedObjectStore, persistBookArtifact } from '@novel-agent/storage';
import { PROJECT_ROOT } from '../lib/paths.js';

// ---------- seed 包格式 ----------

const manifestSchema = z.object({
  slug: z.string().min(1),
  title: z.string().min(1),
  version: z.literal(1),
  exportedAt: z.string(),
  sourceFile: z.string().min(1).default('source.txt'),
  fileSize: z.number().int().nonnegative(),
  counts: z.object({
    characters: z.number().int().nonnegative(),
    locations: z.number().int().nonnegative(),
    items: z.number().int().nonnegative(),
    images: z.number().int().nonnegative(),
  }),
});
export type SeedManifest = z.infer<typeof manifestSchema>;

const entitiesSchema = z.object({
  characters: z.array(z.record(z.string(), z.unknown())),
  locations: z.array(z.record(z.string(), z.unknown())),
  items: z.array(z.record(z.string(), z.unknown())),
});
export type SeedEntities = z.infer<typeof entitiesSchema>;

const imageIndexEntrySchema = z.object({
  entityType: z.enum(['character', 'location', 'item']),
  entityName: z.string().min(1),
  /** posix 相对路径（images/xxx.png），物化时 split('/') 再 join，兼容 Windows。 */
  file: z.string().min(1),
  mime: z.string().min(1),
  ext: z.string().min(1),
  bytes: z.number().int().nonnegative(),
  aspectRatio: z.string().nullish(),
  source: z.string().default('generated'),
  stage: z.string().nullish(),
  isPrimary: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
});
const imageIndexSchema = z.array(imageIndexEntrySchema);
export type SeedImageEntry = z.infer<typeof imageIndexEntrySchema>;

// ---------- 路径 ----------

/** seed-library 目录：默认 {PROJECT_ROOT}/seed-library，SEED_LIBRARY_DIR 可覆盖（测试用）。 */
export function getSeedLibraryDir(): string {
  return process.env.SEED_LIBRARY_DIR ?? resolve(PROJECT_ROOT, 'seed-library');
}

// ---------- 纯函数（可单测） ----------

/** 三表字段集差异是易踩坑：Character 无 tier/importanceScore/pillar/owners（schema L55-77）。 */
const CHARACTER_FIELDS = [
  'name', 'aliases', 'description', 'confidence', 'chapterRef',
  'firstChapter', 'lastChapter', 'chapterAppearances',
  'mentionCount', 'dialogueCount', 'coCharacters', 'outfits',
] as const;
const LOCATION_FIELDS = [
  'name', 'aliases', 'description', 'confidence', 'chapterRef',
  'importanceScore', 'tier', 'storyScore', 'productionScore',
  'pillarCausal', 'pillarUniqueness', 'pillarTransition',
  'mentionCount', 'firstChapter', 'lastChapter', 'chapterAppearances',
] as const;
const ITEM_FIELDS = [...LOCATION_FIELDS, 'owners'] as const;

type SeedRow = Record<string, unknown>;

/** 从导出行中挑出目标表字段（id/bookId/时间戳/status 已被导出工具剥掉，这里再防御一层）。 */
function pickFields(row: SeedRow, fields: readonly string[]): SeedRow {
  const out: SeedRow = {};
  for (const f of fields) {
    if (row[f] !== undefined) out[f] = row[f];
  }
  return out;
}

export function mapCharacterRows(rows: SeedRow[], bookId: string): SeedRow[] {
  return rows.map((r) => ({ ...pickFields(r, CHARACTER_FIELDS), bookId, status: 'APPROVED' }));
}
export function mapLocationRows(rows: SeedRow[], bookId: string): SeedRow[] {
  return rows.map((r) => ({ ...pickFields(r, LOCATION_FIELDS), bookId, status: 'APPROVED' }));
}
export function mapItemRows(rows: SeedRow[], bookId: string): SeedRow[] {
  return rows.map((r) => ({ ...pickFields(r, ITEM_FIELDS), bookId, status: 'APPROVED' }));
}

/**
 * run-summary.json 物化前必须改写 bookId——artifacts.service.ts 校验
 * artifactSummary.bookId === bookId 且 officialResult !== false，否则产物区 available=false。
 */
export function rewriteRunSummary(summary: SeedRow, newBookId: string): SeedRow {
  return { ...summary, bookId: newBookId };
}

/** 解析并校验 manifest（version !== 1 显式拒绝，不静默错乱）。 */
export function parseManifest(raw: unknown): SeedManifest {
  return manifestSchema.parse(raw);
}

/** 校验 manifest 计数与 entities/images 实际数量一致（防打包半成品）。 */
export function assertCountsMatch(
  manifest: SeedManifest,
  entities: SeedEntities,
  imageCount: number,
): void {
  const actual = {
    characters: entities.characters.length,
    locations: entities.locations.length,
    items: entities.items.length,
    images: imageCount,
  };
  const mismatches = (Object.keys(actual) as (keyof typeof actual)[])
    .filter((k) => actual[k] !== manifest.counts[k])
    .map((k) => `${k}: manifest=${manifest.counts[k]} 实际=${actual[k]}`);
  if (mismatches.length > 0) {
    throw new Error(`seed 包计数不一致（${mismatches.join('；')}），请重新导出`);
  }
}

// ---------- 物化 ----------

export interface SeedProvisionResult {
  /** 成功物化的书包（seed-library 下的目录名/slug 列表）。 */
  provisioned: string[];
  /** true = 用户已有书且未指定 force，防御性跳过（幂等）。 */
  skipped: boolean;
}

async function readJsonFile(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf-8'));
}

/**
 * 物化单本书包，返回新 bookId。
 * 顺序：校验 → put source → put 图片 → 单事务建行 → persist artifacts（best-effort）。
 * 失败时 best-effort 删除已建 Book（Cascade 清子行）后 rethrow。
 */
export async function materializeSeedBook(userId: string, seedDir: string): Promise<string> {
  const manifest = parseManifest(await readJsonFile(join(seedDir, 'manifest.json')));
  const entities = entitiesSchema.parse(await readJsonFile(join(seedDir, 'entities.json')));

  let images: SeedImageEntry[] = [];
  try {
    images = imageIndexSchema.parse(await readJsonFile(join(seedDir, 'images', 'index.json')));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  assertCountsMatch(manifest, entities, images.length);

  const store = getSharedObjectStore();
  let bookId: string | null = null;
  try {
    // 1. 原文进对象存储（put 是外部副作用，不进 DB 事务）
    const sourceBody = await readFile(join(seedDir, manifest.sourceFile));
    const storedSource = await store.put({ body: sourceBody, mime: 'text/plain' });

    // 2. 图片字节进对象存储，收集行数据
    const imageRows: SeedRow[] = [];
    for (const entry of images) {
      const body = await readFile(join(seedDir, ...entry.file.split('/')));
      const stored = await store.put({ body, mime: entry.mime });
      imageRows.push({
        entityType: entry.entityType,
        entityName: entry.entityName,
        filePath: '', // 现行约定：图片只走对象存储，filePath 留空
        objectKey: stored.objectKey,
        mime: entry.mime,
        ext: entry.ext,
        bytes: Number(stored.bytes), // put 返回 BigInt（AssetObject.bytes），EntityImage.bytes 是 Int
        aspectRatio: entry.aspectRatio ?? null,
        source: entry.source,
        stage: entry.stage ?? null,
        isPrimary: entry.isPrimary,
        sortOrder: entry.sortOrder,
      });
    }

    // 3. 单事务建 Book + 三表实体 + EntityImage（status 统一 APPROVED——"已审核好"）
    const book = await prisma.$transaction(async (tx) => {
      const created = await tx.book.create({
        data: {
          title: manifest.title,
          filePath: '',
          fileSize: manifest.fileSize,
          mimeType: 'text/plain',
          status: 'EXTRACTED',
          userId,
          sourceObjectKey: storedSource.objectKey,
        },
      });
      const id = created.id;
      if (entities.characters.length > 0) {
        await tx.character.createMany({ data: mapCharacterRows(entities.characters, id) as never });
      }
      if (entities.locations.length > 0) {
        await tx.location.createMany({ data: mapLocationRows(entities.locations, id) as never });
      }
      if (entities.items.length > 0) {
        await tx.item.createMany({ data: mapItemRows(entities.items, id) as never });
      }
      if (imageRows.length > 0) {
        await tx.entityImage.createMany({
          data: imageRows.map((r) => ({ ...r, bookId: id })) as never,
        });
      }
      return created;
    });
    bookId = book.id;

    // 4. artifacts（事务外、best-effort）：run-summary 改写 bookId 后 persist
    try {
      const runSummary = await readJsonFile(join(seedDir, 'run-summary.json'));
      await persistBookArtifact({
        bookId,
        logicalPath: 'run-summary.json',
        category: 'run-summary',
        body: JSON.stringify(rewriteRunSummary(runSummary as SeedRow, bookId)),
      });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    let artifactFiles: string[] = [];
    try {
      artifactFiles = await readdir(join(seedDir, 'artifacts', 'entities'));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    for (const file of artifactFiles) {
      const body = await readFile(join(seedDir, 'artifacts', 'entities', file));
      await persistBookArtifact({
        bookId,
        logicalPath: `entities/${file}`,
        category: 'extraction',
        body,
        mime: file.endsWith('.md') ? 'text/markdown' : 'application/json',
      });
    }

    return bookId;
  } catch (err) {
    if (bookId) {
      // best-effort 清理脏书；对象存储里的孤儿字节内容寻址无害
      await prisma.book.delete({ where: { id: bookId } }).catch(() => {});
    }
    throw err;
  }
}

/**
 * 为新注册用户物化 seed-library/ 下全部书包。
 * 防御性幂等：用户已有任何书则整体跳过（force: true 可绕过，供手动补跑工具用——
 * 功能上线前注册的老用户不会触发注册钩子，需要 CLI 补发）。
 * 单本失败只记日志继续下一本；seed-library 不存在视为无预置书（正常情况）。
 */
export async function provisionSeedLibrary(
  userId: string,
  opts: { force?: boolean } = {},
): Promise<SeedProvisionResult> {
  const dir = getSeedLibraryDir();
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { provisioned: [], skipped: false };
    }
    throw err;
  }

  const existing = await prisma.book.count({ where: { userId } });
  if (existing > 0 && !opts.force) {
    return { provisioned: [], skipped: true };
  }
  // force 模式（手动补跑）：按书名去重，用户已有同名书则跳过该本，防重复补发。
  const existingTitles = opts.force
    ? new Set(
        (await prisma.book.findMany({ where: { userId }, select: { title: true } })).map((b) => b.title),
      )
    : null;

  const provisioned: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      if (existingTitles) {
        const manifest = parseManifest(await readJsonFile(join(dir, entry.name, 'manifest.json')));
        if (existingTitles.has(manifest.title)) continue;
      }
      await materializeSeedBook(userId, join(dir, entry.name));
      provisioned.push(entry.name);
    } catch (err) {
      console.error(
        `[LibrarySeed] 预置书籍「${entry.name}」物化失败（userId=${userId}）：`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return { provisioned, skipped: false };
}
