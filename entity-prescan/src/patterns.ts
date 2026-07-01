/**
 * Shared regex patterns for entity pre-scanning.
 * All patterns are designed for Chinese novel text.
 */

// ─── Chinese Numbers ───
const CN_NUM = '[一二三四五六七八九十百千万亿两壹贰叁肆伍陆柒捌玖拾佰仟萬億零〇]';
const CN_NUM_REG = `${CN_NUM}+`;
// Arabic numbers optionally mixed with Chinese
const NUM_REG = `(?:${CN_NUM_REG}|\\d+)`;

// ─── Character Patterns ───

/** Dialogue verbs that follow character names */
export const DIALOGUE_VERBS = [
  '道', '说', '曰', '言', '笑', '怒', '喝', '骂', '问', '答',
  '叫', '喊', '叹', '哭', '吼', '低语', '喃喃', '冷笑', '大笑',
  '微笑', '苦笑', '轻笑', '嗤笑', '哈哈', '嘿嘿', '哼',
  '说道', '笑道', '怒道', '喝道', '叹道', '问道', '答道',
  '开口', '续道', '接口', '插嘴', '附和',
];

/** Honorific / title words */
export const TITLES = [
  '皇上', '陛下', '太子', '公主', '王爷', '皇子', '皇后', '贵妃',
  '将军', '大人', '大人', '公子', '小姐', '少爷', '夫人', '老爷',
  '道长', '大师', '真人', '仙师', '前辈', '晚辈', '师兄', '师姐',
  '师父', '师叔', '掌门', '宗主', '教主', '盟主', '帮主',
  '老祖', '太上', '长老', '护法', '堂主', '舵主',
];

/** Common Chinese compound surnames */
export const COMPOUND_SURNAMES = [
  '欧阳', '司马', '上官', '诸葛', '东方', '西门', '南宫', '北冥',
  '公孙', '慕容', '令狐', '端木', '皇甫', '轩辕', '独孤', '长孙',
  '宇文', '百里', '司徒', '尉迟', '夏侯', '闻人', '段干', '钟离',
];

// ─── Location Patterns ───

/** Location suffixes */
export const LOCATION_SUFFIXES = [
  '城', '府', '县', '州', '郡', '国', '镇', '村', '庄', '寨',
  '山', '峰', '岭', '谷', '崖', '洞', '窟', '涧', '溪', '河',
  '江', '湖', '海', '岛', '洲', '泽', '泉', '潭', '渊',
  '宫', '殿', '阁', '楼', '台', '亭', '寺', '庙', '庵', '观',
  '塔', '桥', '关', '隘', '门', '坊', '街', '巷', '路',
];

/** Directional / location context words */
export const LOCATION_CONTEXT = [
  '京城', '皇宫', '江湖', '中原', '江南', '塞北', '关外', '西域',
  '东海', '南海', '西山', '北疆', '南方', '北方', '东土', '西天',
  '境内', '城中', '山中', '谷中', '洞中', '府中',
  '之南', '之北', '之东', '之西', '以南', '以北', '以东', '以西',
];

// ─── Item Patterns ───

/** Item suffixes (weapons, treasures, pills) */
export const ITEM_SUFFIXES = [
  '剑', '刀', '枪', '戟', '斧', '钺', '钩', '叉', '鞭', '锏',
  '锤', '棍', '棒', '矛', '盾', '弓', '箭', '弩',
  '镜', '珠', '玉', '石', '印', '符', '令', '旗', '图', '卷',
  '瓶', '葫', '炉', '鼎', '钟', '琴', '棋', '灯',
  '丹', '药', '散', '丸', '液', '露', '膏',
];

/** Item quantifier patterns */
export const ITEM_QUANTIFIERS = [
  '一柄', '一把', '一枚', '一颗', '一张', '一幅', '一座', '一尊',
  '一柄', '一口', '一条', '一道', '一缕', '一丝', '一块', '一团',
];

/** Item context words */
export const ITEM_CONTEXT = [
  '法宝', '神器', '灵器', '仙器', '魔器', '宝物', '灵宝',
  '灵丹', '仙丹', '妙药', '神药', '灵药',
  '功法', '秘籍', '心法', '剑诀', '神通',
];
