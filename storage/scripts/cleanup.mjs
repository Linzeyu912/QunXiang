import { PrismaClient } from '@prisma/client';
import { readdir, unlink } from 'fs/promises';
import { resolve } from 'path';

const prisma = new PrismaClient({
  datasources: { db: { url: 'file:D:/ClaudeData/novel-agent/storage/prisma/prisma/dev.db' } }
});

const UPLOAD_DIR = resolve('D:/ClaudeData/novel-agent/storage/uploads');

async function main() {
  // 1. 删除所有磁盘文件
  const files = await readdir(UPLOAD_DIR);
  const txtFiles = files.filter(f => f.endsWith('.txt'));
  for (const file of txtFiles) {
    await unlink(resolve(UPLOAD_DIR, file));
    console.log('Deleted file:', file);
  }

  // 2. 清空数据库表（按外键依赖顺序）
  await prisma.characterReview.deleteMany({});
  console.log('Cleared CharacterReview');

  await prisma.character.deleteMany({});
  console.log('Cleared Character');

  await prisma.extractionSession.deleteMany({});
  console.log('Cleared ExtractionSession');

  await prisma.task.deleteMany({});
  console.log('Cleared Task');

  await prisma.book.deleteMany({});
  console.log('Cleared Book');

  // 3. 保留 demo-user，删除其他匿名用户（可选）
  const users = await prisma.user.findMany({});
  for (const user of users) {
    if (user.name !== 'demo-user') {
      await prisma.user.delete({ where: { id: user.id } });
      console.log('Deleted user:', user.name);
    }
  }

  console.log('\nCleanup complete!');
  console.log('Files deleted:', txtFiles.length);
  console.log('Books remaining:', await prisma.book.count());
  console.log('Users remaining:', await prisma.user.count());

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
