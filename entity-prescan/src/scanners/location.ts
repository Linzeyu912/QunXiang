/**
 * Location entity scanner — regex-based extraction of place names.
 */
import type { EntityMention, ScanChapter } from '../types.js';

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** High-confidence location suffixes */
const STRICT_SUFFIXES = [
  '城', '府', '县', '州', '郡', '镇', '村', '庄', '寨',
  '山', '峰', '谷', '崖', '洞', '涧', '溪',
  '宫', '殿', '阁', '楼', '台', '亭', '寺', '庙', '庵', '观',
  '塔', '桥', '关', '隘',
];

/** Known locations (proper nouns) */
const KNOWN_LOCATIONS = [
  '京城', '皇宫', '江湖', '中原', '江南', '塞北', '关外', '西域',
  '东海', '南海', '西山', '北疆', '长安', '洛阳', '金陵', '杭州',
  '苏州', '成都', '大理', '开封', '临安', '建康', '许都', '邺城',
  '京兆府', '长乐县', '奉天府',
];

/** Common non-location words */
const STOP_WORDS = new Set([
  '选择', '道路', '方法', '方向', '方面', '方式', '方案',
  '之前', '之后', '之间', '以上', '以下', '以内', '以外',
  '大山', '高山', '深山', '远山', '青山', '群山',
  '大海', '深海', '怒海',
  '高楼', '城楼', '岗楼',
  '高台', '擂台', '站台',
  '大门', '城门', '关门', '闸门', '侧门', '后门', '前门',
  '打更人衙门', '了打更人衙门',
]);

/** Chars that should not appear in a location name */
const BAD_CHARS = new Set([
  '的', '了', '着', '过', '得', '地', '在', '有', '不', '是',
  '把', '被', '让', '给', '对', '和', '与', '及', '或', '但',
  '而', '且', '从', '到', '往', '向', '比', '跟', '即', '使',
  '我', '你', '他', '她', '它', '这', '那', '自',
  '找', '去', '来', '走', '跑', '回', '出', '入', '上', '下',
  '说', '想', '看', '听', '问', '答', '叫', '喊',
  '时', '间', '日', '月', '年', '今', '昨', '明', '后', '前',
  '继', '续', '于', '因', '所', '如', '虽', '就', '也', '都',
  '还', '要', '会', '能', '可', '应', '该', '已', '正',
  '心', '里', '头', '面', '边', '岸', '旁', '附', '近', '远',
  '一', '二', '三', '四', '五', '六', '七', '八', '九', '十',
  '百', '千', '万', '亿', '两', '数', '每', '各', '几',
  '炼', '精', '巅', '峰', '境', '界', '层', '级', '阶',
  '倘', '若', '保', '持', '侵', '供', '本', '作', '传', '遍',
  '任', '仔', '细', '买', '通', '专', '杀', '为', '云',
  '努', '力', '劝', '学', '别', '卖', '利', '用', '再', '次',
  '倒', '靠', '非', '逛', '配', '进', '距', '验', '首', '钥', '匙',
  '适', '才', '党', '脑', '海', '闹', '街',
  '名', '满', '发', '现', '反', '身', '套', '路', '双', '重',
  '赠', '予', '请', '多', '解', '除', '职', '老', '夫', '组',
  '建', '等', '待', '窥', '探', '私', '闯',
  '神', '色', '直', '接', '疑', '惑',
  '由', '甚', '至', '潺', '殿', '此', '事',
  '查', '更', '端',
]);

function isLikelyLocation(text: string): boolean {
  if (text.length < 2 || text.length > 4) return false;
  if (STOP_WORDS.has(text)) return false;
  // Check every character
  for (const ch of text) {
    if (BAD_CHARS.has(ch)) return false;
  }
  return true;
}

/**
 * Scan a single chapter for location entities.
 */
export function scanLocationEntities(chapter: ScanChapter): EntityMention[] {
  const text = chapter.content;
  const mentions: EntityMention[] = [];
  const seen = new Set<string>();

  const addMention = (match: string, index: number, confidence: number) => {
    const trimmed = match.trim();
    if (!isLikelyLocation(trimmed)) return;
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

  // 1. Known locations (exact match) — highest confidence
  const knownRe = new RegExp(
    `(?:${KNOWN_LOCATIONS.map(escapeRegex).join('|')})`,
    'g'
  );
  for (const m of text.matchAll(knownRe)) {
    addMention(m[0], m.index!, 0.95);
  }

  // 2. CJK(2) + strict location suffix — preceded by punctuation
  //    Limit to 2 prefix chars for precision
  const suffixPattern = STRICT_SUFFIXES.map(escapeRegex).join('|');
  const locationRe = new RegExp(
    `(?:[，。！？；：、""\\s])([一-鿿]{2}(?:${suffixPattern}))`,
    'g'
  );
  for (const m of text.matchAll(locationRe)) {
    addMention(m[1], m.index! + m[0].indexOf(m[1]), 0.8);
  }

  // 3. Directional: "在/到/去/往 + CJK+suffix" — capture only the location
  const dirSuffixPattern = '城|府|山|谷|洞|宫|殿|楼|庄|镇|村|寺|庙|岛|湖|河|江|海|关|隘|门|塔|桥|阁|台|亭|庵|观|泉|潭|渊|崖|峰|岭|涧|溪|泽|洲|县|州|郡|国|寨|坊|街|巷|路';
  const dirRe = new RegExp(
    `(?:在|到|去|往|入|出|至|奔|赶往|前往|来到|到达|进入|走出|奔向)([一-鿿]{2,4}(?:${dirSuffixPattern}))`,
    'g'
  );
  for (const m of text.matchAll(dirRe)) {
    addMention(m[1], m.index! + m[0].indexOf(m[1]), 0.75);
  }

  return mentions;
}
