import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const items = await prisma.item.findMany({
    take: 30,
    select: { name: true, category: true, bookId: true },
    orderBy: { createdAt: 'desc' }
  });
  
  console.log('=== 道具数据（最近30条）===');
  items.forEach(i => {
    console.log(`  ${i.name} | category=${i.category} | book=${i.bookId.slice(0,8)}`);
  });
  
  const stats = await prisma.item.groupBy({
    by: ['category'],
    _count: true
  });
  
  console.log('\n=== 分类统计 ===');
  stats.forEach(s => {
    console.log(`  ${s.category}: ${s._count}`);
  });
  
  // 检查是否有异常分类
  const validCategories = ['weapon', 'skill', 'food', 'pill', 'treasure', 'other'];
  const invalidItems = await prisma.item.findMany({
    where: {
      category: { notIn: validCategories }
    },
    select: { name: true, category: true }
  });
  
  if (invalidItems.length > 0) {
    console.log('\n=== 异常分类 ===');
    invalidItems.forEach(i => {
      console.log(`  ${i.name} | category=${i.category}`);
    });
  }
}

main().finally(() => prisma.$disconnect());
