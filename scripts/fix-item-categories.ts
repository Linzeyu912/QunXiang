import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** 根据道具名称推断分类 */
function inferItemCategory(name: string): 'weapon' | 'skill' | 'food' | 'pill' | 'treasure' | 'other' {
  const n = name.toLowerCase();
  
  // 武器类关键词
  const weaponKeywords = ['剑', '刀', '枪', '棍', '棒', '矛', '盾', '弓', '箭', '弩', '斧', '锤', '鞭', '锏', '钩', '叉', '匕首', '短剑', '长剑', '重尺', '玄重尺'];
  if (weaponKeywords.some(k => n.includes(k))) return 'weapon';
  
  // 技能/功法类关键词
  const skillKeywords = ['功', '诀', '法', '术', '技', '式', '招', '心法', '口诀', '秘籍', '剑谱', '掌', '拳', '腿', '指', '爪', '身法', '步法'];
  if (skillKeywords.some(k => n.includes(k))) return 'skill';
  
  // 丹药/消耗品类关键词
  const pillKeywords = ['丹', '丸', '散', '药', '液', '露', '膏', '剂', '草', '灵药', '仙丹', '灵丹'];
  if (pillKeywords.some(k => n.includes(k))) return 'pill';
  
  // 食物类关键词
  const foodKeywords = ['果', '茶', '酒', '饭', '菜', '食', '饼', '糕', '汤'];
  if (foodKeywords.some(k => n.includes(k))) return 'food';
  
  // 法宝/器物类关键词
  const treasureKeywords = ['宝', '符', '镜', '珠', '玉', '印', '令', '旗', '图', '卷', '瓶', '葫', '炉', '鼎', '钟', '琴', '棋', '灯', '戒', '镯', '佩', '环', '簪', '冠', '袍', '甲', '靴', '带', '囊', '袋', '盒', '箱'];
  if (treasureKeywords.some(k => n.includes(k))) return 'treasure';
  
  return 'other';
}

async function main() {
  // 找出所有 category 为 other 的道具
  const items = await prisma.item.findMany({
    where: { category: 'other' },
    select: { id: true, name: true, category: true }
  });
  
  console.log(`找到 ${items.length} 个 category=other 的道具`);
  
  let updated = 0;
  const stats: Record<string, number> = { weapon: 0, skill: 0, food: 0, pill: 0, treasure: 0, other: 0 };
  
  for (const item of items) {
    const inferred = inferItemCategory(item.name);
    stats[inferred]++;
    
    if (inferred !== 'other') {
      await prisma.item.update({
        where: { id: item.id },
        data: { category: inferred }
      });
      updated++;
      console.log(`  ${item.name} -> ${inferred}`);
    }
  }
  
  console.log(`\n更新完成：${updated} 个道具被重新分类`);
  console.log('分类统计：');
  Object.entries(stats).forEach(([cat, count]) => {
    console.log(`  ${cat}: ${count}`);
  });
}

main().finally(() => prisma.$disconnect());
