// 把"影子用户"（email 形如 <uuid>@example.com，历史 findOrCreate 桥接产物）合并回真实用户。
// 真实用户 id 即影子 email 里的 uuid。重赋值 Book/CharacterReview/ExtractionSession.userId 后删除影子行。
// 幂等：无影子用户时为 no-op。--dry-run 仅打印不写库。
import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
const SHADOW_RE = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})@example\.com$/;
const dry = process.argv.includes('--dry-run');

const all = await db.user.findMany();
const targets = [];
for (const s of all) {
  const m = s.email.match(SHADOW_RE);
  if (!m) continue;
  const realId = m[1];
  const real = await db.user.findUnique({ where: { id: realId } });
  const counts = {
    books: await db.book.count({ where: { userId: s.id } }),
    reviews: await db.characterReview.count({ where: { userId: s.id } }),
    sessions: await db.extractionSession.count({ where: { userId: s.id } }),
  };
  targets.push({ shadow: s, realId, realExists: !!real, counts });
}

console.log(`shadow users: ${targets.length}`);
if (targets.length === 0) { console.log('nothing to do'); await db.$disconnect(); process.exit(0); }

for (const t of targets) {
  console.log(`  shadow ${t.shadow.id} (email=${t.shadow.email}) → real ${t.realId} (exists=${t.realExists}) | books=${t.counts.books} reviews=${t.counts.reviews} sessions=${t.counts.sessions}`);
}

if (dry) {
  console.log('\n[DRY RUN] no changes written');
  await db.$disconnect();
  process.exit(0);
}

for (const t of targets) {
  if (!t.realExists) {
    console.log(`  SKIP shadow ${t.shadow.id}: real user ${t.realId} not found (leaving as-is to avoid orphan)`);
    continue;
  }
  await db.$transaction([
    db.book.updateMany({ where: { userId: t.shadow.id }, data: { userId: t.realId } }),
    db.characterReview.updateMany({ where: { userId: t.shadow.id }, data: { userId: t.realId } }),
    db.extractionSession.updateMany({ where: { userId: t.shadow.id }, data: { userId: t.realId } }),
    db.user.delete({ where: { id: t.shadow.id } }),
  ]);
  console.log(`  MIGRATED shadow ${t.shadow.id} → real ${t.realId}`);
}

// verify
const remainingShadows = (await db.user.findMany()).filter(u => SHADOW_RE.test(u.email));
console.log(`\nremaining shadow users: ${remainingShadows.length}`);
const books = await db.book.findMany();
for (const b of books) {
  const owner = await db.user.findUnique({ where: { id: b.userId } });
  console.log(`  book "${b.title}" userId=${b.userId} owner=${owner?.email} pwd=${owner?.passwordHash ? 'Y' : 'N'}`);
}
await db.$disconnect();
