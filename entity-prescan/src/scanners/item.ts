/**
 * Item entity scanner — regex-based extraction of objects, weapons, treasures.
 */
import type { EntityMention, ScanChapter } from '../types.js';

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Weapon suffixes */
const WEAPON_SUFFIXES = ['剑', '刀', '枪', '戟', '斧', '钺', '钩', '叉', '鞭', '锏', '锤', '棍', '棒', '矛', '弓', '箭', '弩'];
/** Treasure/artifact suffixes */
const TREASURE_SUFFIXES = ['镜', '珠', '玉', '印', '符', '令', '旗', '图', '卷', '瓶', '葫', '炉', '鼎', '钟', '琴', '灯'];
/** Pill/medicine suffixes */
const PILL_SUFFIXES = ['丹', '药', '散', '丸'];
const ALL_SUFFIXES = [...WEAPON_SUFFIXES, ...TREASURE_SUFFIXES, ...PILL_SUFFIXES];

/** Item context words */
const ITEM_CONTEXT = [
  '法宝', '神器', '灵器', '仙器', '魔器', '宝物', '灵宝',
  '灵丹', '仙丹', '妙药', '神药', '灵药',
  '功法', '秘籍', '心法', '剑诀', '神通',
];

/** Descriptor chars that can start an item name (color/material/quality/creature) */
const DESCRIPTOR_CHARS = '金银铜铁玉翡翠玛瑙琉璃紫青红黑蓝碧赤玄素墨冰火雷龙凤虎鹤蛇龟狼鹰仙神魔圣灵宝寒烈幽阴阳霜雪焰霞鬼妖魔兽毒蛊血骨丝绵鳞甲';

/**
 * Scan a single chapter for item entities.
 */
export function scanItemEntities(chapter: ScanChapter): EntityMention[] {
  const text = chapter.content;
  const mentions: EntityMention[] = [];
  const seen = new Set<string>();

  const addMention = (match: string, index: number, confidence: number) => {
    const trimmed = match.trim();
    if (trimmed.length < 2 || trimmed.length > 8) return;
    const key = `${chapter.index}|${trimmed}|${index}`;
    if (!seen.has(key)) {
      seen.add(key);
      mentions.push({
        text: trimmed,
        chapterIndex: chapter.index,
        position: index,
        source: 'regex',
        confidence,
      });
    }
  };

  const suffixPattern = ALL_SUFFIXES.map(escapeRegex).join('|');

  // 1. Descriptor(1-2) + CJK(0-2) + item suffix
  //    e.g. "青锋剑", "紫金葫芦", "九转金丹", "玄铁重剑"
  const itemRe = new RegExp(
    `(?:[，。！？；：、""\\s])([${DESCRIPTOR_CHARS}][一-鿿]{1,3}(?:${suffixPattern}))`,
    'g'
  );
  for (const m of text.matchAll(itemRe)) {
    addMention(m[1], m.index! + m[0].indexOf(m[1]), 0.8);
  }

  // 2. Item context words (standalone)
  const contextPattern = ITEM_CONTEXT.map(escapeRegex).join('|');
  const contextRe = new RegExp(`(?:${contextPattern})`, 'g');
  for (const m of text.matchAll(contextRe)) {
    addMention(m[0], m.index!, 0.5);
  }

  return mentions;
}
