import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../app.js';
import { prisma, getSharedObjectStore, readBookArtifactJson } from '@qunxiang/storage';
import { getExtractionArtifacts } from '../services/artifacts.service.js';
import { provisionSeedLibrary, processSeedProvisionJob } from '../services/library-seed.service.js';

const ORIGIN = 'http://localhost:5173';

/** 1x1 PNG 最小合法字节 */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function writeSeedBook(dir: string, opts: { badManifest?: boolean } = {}) {
  await mkdir(join(dir, 'artifacts', 'entities'), { recursive: true });
  await mkdir(join(dir, 'images'), { recursive: true });
  await writeFile(join(dir, 'source.txt'), '第一章 陨落的天才\n萧炎望着石碑。\n', 'utf-8');
  await writeFile(
    join(dir, 'entities.json'),
    JSON.stringify({
      characters: [{ name: '萧炎', aliases: ['小炎子'], description: '主角', confidence: 0.95, mentionCount: 10, dialogueCount: 3, firstChapter: 1 }],
      locations: [{ name: '乌坦城', aliases: [], tier: 'core', importanceScore: 8.5, pillarCausal: 2 }],
      items: [{ name: '玄重尺', aliases: [], owners: ['萧炎'] }],
    }),
    'utf-8',
  );
  await writeFile(
    join(dir, 'run-summary.json'),
    JSON.stringify({
      bookId: 'will-be-rewritten',
      officialResult: true,
      generatedAt: '2026-07-24T00:00:00.000Z',
      outputs: { finalSummary: 'output/seed-run-1/final/run-summary.json' },
      counts: { characters: 1, locations: 1, items: 1 },
    }),
    'utf-8',
  );
  await writeFile(
    join(dir, 'artifacts', 'entities', 'character-prompts.json'),
    JSON.stringify([{ entityName: '萧炎', prompt: '黑衣少年，手持玄重尺', source: 'generated' }]),
    'utf-8',
  );
  await writeFile(join(dir, 'images', '0.png'), TINY_PNG);
  await writeFile(
    join(dir, 'images', 'index.json'),
    JSON.stringify([{
      entityType: 'character', entityName: '萧炎', file: 'images/0.png',
      mime: 'image/png', ext: '.png', bytes: TINY_PNG.length,
      aspectRatio: '1:1', source: 'generated', stage: null, isPrimary: true, sortOrder: 0,
    }]),
    'utf-8',
  );
  await writeFile(
    join(dir, 'manifest.json'),
    opts.badManifest
      ? JSON.stringify({ slug: 'bad', version: 99 })
      : JSON.stringify({
          slug: 'seed-demo',
          title: '预置演示书',
          version: 1,
          exportedAt: '2026-07-24T00:00:00.000Z',
          sourceFile: 'source.txt',
          fileSize: 30,
          counts: { characters: 1, locations: 1, items: 1, images: 1 },
        }),
    'utf-8',
  );
}

describe('公共书库：注册时物化预置书籍', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let seedRoot: string;
  let prevSeedLibraryDir: string | undefined;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    process.env.JWT_SECRET = 'seed-integration-test-secret';
    process.env.LLM_PROVIDER = 'mock';
    process.env.NODE_ENV = 'test';
    process.env.ALLOWED_ORIGINS = ORIGIN;
    process.env.OBJECT_STORAGE_SIGN_SECRET = 'seed-test-sign-secret';

    seedRoot = await mkdtemp(join(tmpdir(), 'seed-library-'));
    await mkdir(join(seedRoot, 'demo-book'), { recursive: true });
    await writeSeedBook(join(seedRoot, 'demo-book'));
    prevSeedLibraryDir = process.env.SEED_LIBRARY_DIR;
    process.env.SEED_LIBRARY_DIR = seedRoot;

    app = await buildApp({ logger: false });
  });

  afterAll(async () => {
    // 还原而非删除：test-runner 会给全局默认空目录，直接 delete 会让
    // 同进程后续测试回落到真实 seed-library。
    if (prevSeedLibraryDir === undefined) {
      delete process.env.SEED_LIBRARY_DIR;
    } else {
      process.env.SEED_LIBRARY_DIR = prevSeedLibraryDir;
    }
    if (createdUserIds.length > 0) {
      await prisma.book.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await rm(seedRoot, { recursive: true, force: true });
    if (app) await app.close();
  });

  async function register(email: string) {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      headers: { origin: ORIGIN },
      payload: { email, password: 'secret123', name: '种子用户' },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { user: { id: string } };
    createdUserIds.push(body.user.id);
    return body.user.id;
  }

  it('注册后书架出现预置书：EXTRACTED、实体 APPROVED、图片与产物可用', async () => {
    const userId = await register(`seed-ok-${randomUUID()}@seed.test`);

    // 异步初始化（实施包 B2）：注册立即有占位书行（SEED_PREPARING，来源 SEED）
    const placeholders = await prisma.book.findMany({ where: { userId } });
    expect(placeholders).toHaveLength(1);
    expect(placeholders[0].sourceType).toBe('SEED');

    // 后台任务逐本物化；轮询等待完成（示例书禁止伪造提取阶段）
    await processSeedProvisionJob(userId);
    const books = await prisma.book.findMany({ where: { userId } });
    expect(books).toHaveLength(1);
    const book = books[0];
    expect(book.title).toBe('预置演示书');
    expect(book.status).toBe('EXTRACTED');
    expect(book.sourceObjectKey).toBeTruthy();
    expect(book.sourcePackageId).toBe('seed-demo');

    // 示例书带一条 kind=IMPORTED 的已完成运行，真实清单写入 manifest
    const sessions = await prisma.extractionSession.findMany({ where: { bookId: book.id } });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].kind).toBe('IMPORTED');
    expect(sessions[0].status).toBe('COMPLETED');
    expect(book.currentExtractionSessionId).toBe(sessions[0].id);

    // 原文可从对象存储读回
    const stored = await getSharedObjectStore().get(book.sourceObjectKey!);
    expect(Buffer.from(stored.bytes).toString('utf-8')).toContain('萧炎');

    // 三类实体：计数对、status 全 APPROVED、字段集正确
    const [chars, locs, items] = await Promise.all([
      prisma.character.findMany({ where: { bookId: book.id } }),
      prisma.location.findMany({ where: { bookId: book.id } }),
      prisma.item.findMany({ where: { bookId: book.id } }),
    ]);
    expect(chars.map((c) => c.name)).toEqual(['萧炎']);
    expect(chars[0].status).toBe('APPROVED');
    expect(chars[0].reviewSource).toBe('IMPORTED');
    expect(chars[0].dialogueCount).toBe(3);
    expect(locs[0].tier).toBe('core');
    expect(locs[0].status).toBe('APPROVED');
    expect(items[0].owners).toEqual(['萧炎']);
    expect(items[0].status).toBe('APPROVED');

    // 图片：行走对象存储（filePath 空、objectKey 有值）
    const images = await prisma.entityImage.findMany({ where: { bookId: book.id } });
    expect(images).toHaveLength(1);
    expect(images[0].objectKey).toBeTruthy();
    expect(images[0].filePath).toBe('');
    expect(images[0].isPrimary).toBe(true);

    // run-summary 的 bookId 已改写（artifacts.service 的 available 判定依赖它）
    const summary = await readBookArtifactJson<{ bookId?: string }>(book.id, 'run-summary.json');
    expect(summary?.bookId).toBe(book.id);

    // 产物区 available=true 且提示词按实体名可取
    const artifacts = await getExtractionArtifacts(book.id, userId);
    expect(artifacts.available).toBe(true);
    expect(artifacts.characters['萧炎']?.prompt?.prompt).toContain('玄重尺');
  }, 30000);

  it('重复 provision 因用户已有书而跳过（幂等）', async () => {
    const userId = await register(`seed-idem-${randomUUID()}@seed.test`);
    expect(await prisma.book.count({ where: { userId } })).toBe(1);

    const again = await provisionSeedLibrary(userId);
    expect(again.skipped).toBe(true);
    expect(await prisma.book.count({ where: { userId } })).toBe(1);
  }, 30000);

  it('force 补跑：已有书不跳过，但按书名去重防重复补发', async () => {
    const userId = await register(`seed-force-${randomUUID()}@seed.test`);
    expect(await prisma.book.count({ where: { userId } })).toBe(1);

    // 同名书已存在 → force 也不重复补发
    const dedup = await provisionSeedLibrary(userId, { force: true });
    expect(dedup.skipped).toBe(false);
    expect(dedup.provisioned).toHaveLength(0);
    expect(await prisma.book.count({ where: { userId } })).toBe(1);

    // 删掉原书后 → force 能补发成功（老用户回填场景）
    await prisma.book.deleteMany({ where: { userId } });
    const refill = await provisionSeedLibrary(userId, { force: true });
    expect(refill.provisioned).toEqual(['demo-book']);
    expect(await prisma.book.count({ where: { userId } })).toBe(1);
  }, 30000);

  it('坏 manifest 不阻断注册：注册成功但无书', async () => {
    await mkdir(join(seedRoot, 'bad-book'), { recursive: true });
    await writeSeedBook(join(seedRoot, 'bad-book'), { badManifest: true });

    const userId = await register(`seed-bad-${randomUUID()}@seed.test`);
    // demo-book 成功、bad-book 失败 → 仍有 1 本书；坏包不拖垮注册
    expect(await prisma.book.count({ where: { userId } })).toBe(1);

    await rm(join(seedRoot, 'bad-book'), { recursive: true, force: true });
  }, 30000);

  it('seed-library 目录不存在时静默跳过', async () => {
    const prev = process.env.SEED_LIBRARY_DIR;
    process.env.SEED_LIBRARY_DIR = join(seedRoot, 'does-not-exist');
    try {
      const result = await provisionSeedLibrary('some-user-id');
      expect(result).toEqual({ provisioned: [], skipped: false });
    } finally {
      process.env.SEED_LIBRARY_DIR = prev;
    }
  });
});
