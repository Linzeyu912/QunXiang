/**
 * 修复已物化的“凡人修仙传150章”预置书原文。
 *
 * 早期 seed source.txt 已作为乱码字节写入对象存储；对象存储不可变，
 * 因此只更新仍指向该错误对象的 Book 记录，不触碰用户自行上传的同名书。
 *
 * 用法：pnpm --filter @qunxiang/api seed:repair-fanren [--apply]
 * 默认仅输出受影响数量；传 --apply 后执行迁移。
 */
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { closeDatabase, getSharedObjectStore, prisma } from '@qunxiang/storage';
import { PROJECT_ROOT } from '../src/lib/paths.js';

// 旧 seed-library/fanren/source.txt（CRLF 工作区字节）的内容寻址键。
const CORRUPTED_SOURCE_OBJECT_KEY =
  'obj/15/a4/15a4fb9983096fe4d1eae2134ec4772721307cf8613b3b932471642c91b743b1';

async function main() {
  const apply = process.argv.slice(2).includes('--apply');
  const affected = await prisma.book.findMany({
    where: { sourceObjectKey: CORRUPTED_SOURCE_OBJECT_KEY },
    select: { id: true, title: true, user: { select: { email: true } } },
  });

  if (affected.length === 0) {
    console.log('未发现仍引用旧版乱码原文的预置书。');
    return;
  }

  console.log(`发现 ${affected.length} 本待修复书籍：`);
  for (const book of affected) console.log(`- ${book.title}（${book.user.email}）`);
  if (!apply) {
    console.log('这是预览模式；确认后执行 pnpm --filter @qunxiang/api seed:repair-fanren --apply。');
    return;
  }

  const source = await readFile(join(PROJECT_ROOT, 'seed-library', 'fanren', 'source.txt'));
  const text = source.toString('utf8');
  if (text.includes('�')) throw new Error('修复源文件仍含乱码替换字符，已取消迁移');

  const stored = await getSharedObjectStore().put({ body: source, mime: 'text/plain' });
  const result = await prisma.book.updateMany({
    where: { sourceObjectKey: CORRUPTED_SOURCE_OBJECT_KEY },
    data: { sourceObjectKey: stored.objectKey, fileSize: source.length },
  });
  console.log(`已修复 ${result.count} 本预置书章节原文。`);
}

main()
  .catch((error) => {
    console.error('修复失败：', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase();
  });
