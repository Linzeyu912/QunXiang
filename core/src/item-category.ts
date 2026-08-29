/**
 * 道具大类推断：LLM 未返回 category（或返回 other）时的共享兜底。
 *
 * 双通道：先按道具名称关键词匹配，名称无法判断时再扫描述文本。
 * 提取管道（跨批去重、入库映射）与存量数据回填共用同一份实现，
 * 避免两处关键词表漂移。分类体系与 zod 枚举一致：
 * weapon / skill / food / pill / treasure / other。
 */
import type { ItemCategory } from './types.js';

/** 名称关键词：按检查顺序排列，先具体后宽泛。
 *  电子设备与文件信物放在食物/法宝之前，防止现代题材误伤
 *  （如"苹果笔记本"被"果"误判为食物、"面试邀请信"被"宝"误判）。 */
const NAME_RULES: Array<{ category: Exclude<ItemCategory, 'other'>; keywords: string[] }> = [
  {
    category: 'weapon',
    keywords: [
      '剑', '刀', '枪', '棍', '棒', '矛', '盾', '弓', '箭', '弩', '斧', '锤', '鞭', '锏', '钩', '叉',
      '匕首', '短剑', '长剑', '重尺', '玄重尺', '暗器',
    ],
  },
  {
    // 电子设备：现代题材常见物。放在 skill 之前，防止"老式IBM笔记本"被"式"误判为功法、
    // "苹果笔记本"被"果"误判为食物
    category: 'electronics',
    keywords: [
      '手机', '电脑', '笔记本', '电话', '相机', '耳机', '平板', '游戏机', '电视机', '收音机',
      'MP3', 'MP4', 'PDA', '传呼机', '对讲机', '投影仪', '笔记本电脑',
    ],
  },
  {
    // 文件信物：信函、证件、照片、书籍报刊等。同样前置防止被泛字误伤
    category: 'document',
    keywords: [
      '信', '函', '通知书', '邀请函', '申请表', '文件', '档案', '简历', '履历', '证书', '证件',
      '照片', '相簿', '相册', '报纸', '杂志', '名片', '日记', '画册', '支票', '钞票', '录取通知书',
    ],
  },
  {
    category: 'skill',
    keywords: [
      '功', '诀', '法', '术', '技', '式', '招', '心法', '口诀', '秘籍', '剑谱', '掌', '拳', '腿', '指', '爪',
      '身法', '步法',
    ],
  },
  {
    category: 'pill',
    keywords: [
      '丹', '丸', '散', '药', '液', '露', '膏', '剂', '草', '灵药', '仙丹', '灵丹', '仙品', '芝', '参',
    ],
  },
  { category: 'food', keywords: ['果', '茶', '酒', '饭', '菜', '食', '饼', '糕', '汤', '肠'] },
  {
    category: 'treasure',
    keywords: [
      '宝', '符', '镜', '珠', '玉', '印', '令', '旗', '图', '卷', '瓶', '葫', '炉', '鼎', '钟', '琴', '棋',
      '灯', '戒', '镯', '佩', '环', '簪', '冠', '袍', '甲', '靴', '带', '囊', '袋', '盒', '箱', '魂骨', '徽章', '晶',
    ],
  },
];

/** 描述关键词：名称判不出来时按描述里的性质词归类 */
const DESCRIPTION_RULES: Array<{ category: Exclude<ItemCategory, 'other'>; keywords: string[] }> = [
  { category: 'weapon', keywords: ['武器', '兵器', '利刃', '暗器', '射出', '挥出'] },
  { category: 'skill', keywords: ['功法', '斗技', '魂技', '招式', '施展', '修炼之法', '口诀'] },
  { category: 'pill', keywords: ['丹药', '服用', '炼制', '灵草', '仙草', '药效', '疗伤', '恢复'] },
  { category: 'food', keywords: ['食物', '食用', '充饥', '美味', '佳肴'] },
  { category: 'electronics', keywords: ['电子', '屏幕', '上网', '通话', '拍照', '电子设备', '笔记本', '手机'] },
  { category: 'document', keywords: ['信件', '文件', '证件', '书信', '照片', '邮件', '录取', '面试通知'] },
  { category: 'treasure', keywords: ['法宝', '信物', '宝物', '魂骨', '贵重', '遗物', '秘宝'] },
];

function matchRules(
  text: string,
  rules: Array<{ category: Exclude<ItemCategory, 'other'>; keywords: string[] }>,
): ItemCategory | null {
  const n = text.toLowerCase();
  for (const rule of rules) {
    if (rule.keywords.some((k) => n.includes(k.toLowerCase()))) return rule.category;
  }
  return null;
}

/**
 * 推断道具大类：名称优先，名称无命中再看描述。
 * 两个通道都判不出时返回 other。
 */
export function inferItemCategory(name: string, description?: string): ItemCategory {
  const byName = matchRules(name, NAME_RULES);
  if (byName) return byName;
  if (description) {
    const byDesc = matchRules(description, DESCRIPTION_RULES);
    if (byDesc) return byDesc;
  }
  return 'other';
}
