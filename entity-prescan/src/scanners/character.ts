/**
 * Character entity scanner — regex-based extraction of character name mentions.
 * Uses strict patterns to minimize false positives.
 */
import type { EntityMention, ScanChapter } from '../types.js';
import { DIALOGUE_VERBS, TITLES, COMPOUND_SURNAMES } from '../patterns.js';

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Common non-name words to exclude */
const STOP_WORDS = new Set([
  '说道', '一个', '这个', '那个', '什么', '怎么', '知道', '没有',
  '不是', '可以', '已经', '他们', '我们', '你们', '自己', '这里',
  '那里', '哪里', '时候', '现在', '可能', '应该', '因为', '所以',
  '但是', '不过', '而且', '虽然', '如果', '这样', '那样',
  '如何', '为何', '只见', '却见', '但见', '忽见', '便见', '正见',
  '忽然', '突然', '竟然', '居然', '果然', '显然', '当然', '必然',
  '众人', '大家', '所有', '敌人', '对方', '此人', '那人',
  '选择', '需要', '开始', '觉得', '发现', '出来', '起来', '一下',
  '还是', '然后', '只是', '有些', '原来', '于是', '还有',
  '其他', '许多', '一声', '一点', '一些', '一样', '一般', '一定',
  '不敢', '不到', '不想', '不能', '不会', '不得', '不好', '不错',
  '之间', '之后', '之前', '以上', '以下', '以内', '以外',
  '大奉', '朝廷', '衙门', '皇宫', '江湖', '天下', '世间',
  // Non-name common nouns
  '狱卒', '捕快', '侍卫', '士兵', '将军', '大人', '小人',
  '冤枉', '明白', '清楚', '感激', '佩服', '惊讶', '愤怒',
  // Adverbs / descriptive words that look like names
  '徐徐', '连声', '贼人', '别瞎', '炼精', '巅峰', '通常',
  '郁闷', '连忙', '明知', '安慰', '解释', '一声', '冷笑',
  '大怒', '大笑', '微笑', '苦笑', '轻笑', '怒道', '笑道',
  // More false positives from self-introduction
  '苦主', '良民', '读书', '捣蛋', '无奈', '满意', '暴躁',
  '盘树', '相传', '终于', '都没', '边回', '打更',
  '键盘', '侠嘛', '要进', '戴回', '找洛', '就在',
  '因缘', '际会', '天宗', '门人', '百里',
  // Common words that start with surnames
  '宣布', '严肃', '厉害', '利用', '利益', '便利',
  '仰天', '仰望', '仰头', '利箭', '利器', '利刃',
  '百里丢', '百里加',
]);

/** Chars that should not appear in a character name */
const BAD_CHARS = new Set([
  // particles & auxiliaries
  '的', '了', '着', '过', '得', '地', '吗', '呢', '吧', '啊', '呀', '哦', '嗯',
  // pronouns
  '我', '你', '他', '她', '它', '这', '那', '自',
  // common verbs (including dialogue verbs to prevent name+verb fusion)
  '看', '听', '想', '知', '做', '来', '去', '说', '叫', '喊', '问', '答',
  '出', '入', '上', '下', '开', '关', '走', '坐', '站', '抓', '起',
  '道', '曰', '言', '笑', '怒', '喝', '骂', '叹', '哭', '吼',
  // prepositions & conjunctions
  '把', '被', '让', '给', '对', '和', '与', '及', '或', '但', '而', '且',
  '从', '到', '往', '向', '比', '跟', '即', '使', '尽',
  // common modifiers
  '大', '小', '多', '少', '好', '坏', '新', '旧', '老', '少',
  '高', '低', '长', '短', '远', '近', '深', '浅', '快', '慢',
  '冷', '热', '轻', '重', '硬', '软', '明', '暗', '强', '弱',
  // body/face chars that appear in descriptions
  '头', '手', '眼', '脸', '口', '身', '心', '眉', '目', '耳', '鼻',
  '发', '血', '肉', '骨', '皮', '牙', '舌',
  // emotional/action descriptors
  '惊', '怒', '怕', '爱', '恨', '愁', '急', '慌', '忙',
  '呆', '傻', '疯', '狂', '怨',
  // direction/time
  '前', '后', '左', '右', '东', '西', '南', '北', '中', '内', '外',
  '今', '昨', '明', '早', '晚', '午', '夜', '日', '月', '年',
  // cultivation / description terms
  '巅', '峰', '炼', '精', '气', '神', '元', '灵', '魂', '魄',
  '声', '贼', '瞎', '连', '副', '按', '摸', '挥', '挡',
  '举', '抬', '低', '沉', '转', '望', '扫', '瞥',
  '丢', '枷', '锁', '箭', '仰',
]);

/** 组织/家族/门派后缀 —— 以这些结尾的不是人名（云岚宗/萧家/萧族 等误判） */
const ORG_SUFFIXES = new Set([
  '宗', '家', '族', '门', '派', '教', '阁', '殿', '堂',
  '谷', '庄', '宫', '寺', '院', '会', '帮', '盟',
]);

function isLikelyName(text: string): boolean {
  if (text.length < 2 || text.length > 4) return false;
  if (STOP_WORDS.has(text)) return false;
  if (!/^[一-鿿]{2,4}$/.test(text)) return false;
  if (ORG_SUFFIXES.has(text[text.length - 1])) return false;
  for (const ch of text) {
    if (BAD_CHARS.has(ch)) return false;
  }
  return true;
}

const REAL_COMMON_SURNAMES = new Set(Array.from(
  '\u8d75\u94b1\u5b59\u674e\u5468\u5434\u90d1\u738b\u51af\u9648\u891a\u536b\u848b\u6c88\u97e9\u6768' +
  '\u6731\u79e6\u5c24\u8bb8\u4f55\u5415\u65bd\u5f20\u5b54\u66f9\u4e25\u534e\u91d1\u9b4f\u9676' +
  '\u59dc\u621a\u8c22\u90b9\u55bb\u67cf\u6c34\u7aa6\u7ae0\u4e91\u82cf\u6f58\u845b\u595a\u8303' +
  '\u5f6d\u90ce\u9c81\u97e6\u660c\u9a6c\u82d7\u51e4\u82b1\u65b9\u4fde\u4efb\u8881\u67f3\u9146' +
  '\u9c8d\u53f2\u5510\u8d39\u5ec9\u5c91\u859b\u96f7\u8d3a\u502a\u6c64\u6ed5\u6bb7\u7f57\u6bd5' +
  '\u90dd\u90ac\u5b89\u5e38\u4e50\u4e8e\u65f6\u5085\u76ae\u535e\u9f50\u5eb7\u4f0d\u4f59\u5143' +
  '\u535c\u987e\u5b5f\u5e73\u9ec4\u548c\u7a46\u8427\u5c39\u6b27\u6881\u6b66\u9f99\u53f6\u53f8' +
  '\u95fb\u590f\u4faf\u8bf8\u845b\u4e0a\u5b98\u53f8\u9a6c\u6b27\u9633'
));

const REAL_COMPOUND_SURNAMES = [
  '\u6b27\u9633', '\u53f8\u9a6c', '\u4e0a\u5b98', '\u8bf8\u845b', '\u4e1c\u65b9',
  '\u897f\u95e8', '\u5357\u5bab', '\u5317\u51a5', '\u516c\u5b59', '\u6155\u5bb9',
  '\u53f8\u5f92', '\u4ee4\u72d0', '\u7687\u752b', '\u5b87\u6587', '\u957f\u5b59',
  '\u590f\u4faf', '\u95fb\u4eba',
];

const REAL_STOP_WORDS = new Set([
  '\u8bb8\u591a', '\u65b9\u5411', '\u65b9\u6cd5', '\u65b9\u5f0f', '\u7a0b\u5ea6',
  '\u9ad8\u5174', '\u9ec4\u91d1', '\u767d\u94f6', '\u9a6c\u8f66', '\u5b89\u9759',
  '\u5e38\u5e38', '\u4e8e\u662f', '\u4f55\u51b5', '\u4f55\u4e8b', '\u4efb\u4f55',
  '\u5468\u56f4', '\u5b59\u5b50', '\u738b\u671d', '\u738b\u5bab', '\u9648\u5217',
  '\u6210\u529f', '\u53e4\u602a', '\u76f8\u4fe1', '\u7ec8\u7a76', '\u5bb6\u4f19',
  '\u5b98\u5458', '\u5b98\u573a', '\u53cc\u65b9', '\u65f6\u4ee3', '\u7ecf\u5386',
  '\u89e3\u51b3', '\u5305\u62ec', '\u5b89\u5168', '\u6210\u5458', '\u9ec4\u660f',
  '\u8bb8\u5e9c', '\u94b1\u94f6\u5b50', '\u77f3\u5c0f\u955c', '\u4e91\u9e7f\u4e66\u9662',
  '\u4e07\u5996\u56fd', '\u767d\u8863', '\u767d\u5ae6', '\u6b66\u592b', '\u56fd\u5b50\u76d1',
]);

const REAL_BAD_NAME_CHARS = new Set(Array.from(
  '\u7684\u4e86\u7740\u8fc7\u5728\u91cc\u4e0a\u4e0b\u4e2d\u524d\u540e\u5de6\u53f3' +
  '\u591a\u5c11\u5411\u5ea6\u6cd5\u5f0f\u95f4\u6765\u53bb\u8d77\u51fa\u5165\u770b' +
  '\u542c\u8bf4\u95ee\u7b54\u60f3\u89c9\u77e5\u5c06\u628a\u88ab\u4e0e\u548c\u6216' +
  '\u5c31\u90fd\u80fd\u4f1a\u8981\u53ef\u5e94\u4ee5\u4ece\u5230\u4e3a\u4eba\u4e8b' +
  '\u7269\u5730\u5929\u5927\u5c0f\u597d\u574f\u65b0\u65e7\u957f\u77ed\u5feb\u6162' +
  '\u6709\u6ca1\u4e0d\u4e00'
));

const REAL_CHARACTER_CONTEXT_CHARS = new Set(Array.from(
  '\u8bf4\u9053\u95ee\u7b54\u7b11\u6012\u559d\u9a82\u558a\u53f9\u770b\u671b\u77a7\u76ef' +
  '\u70b9\u6447\u8d70\u6765\u53bb\u5165\u51fa\u62ff\u63a8\u62c9\u6253\u6740\u6551' +
  '\u62a4\u5e2e\u653b\u9632\u8fdb\u9000\u5750\u7ad9\u8dea\u62dc\u53eb\u540d\u662f' +
  '\u5411\u5bf9\u4e0e\u540c\u89c1\u627e\u8ddf\u968f\u5e26\u7ed9\u8ba9\u5c06\u4ee4' +
  '\u79bb'
));

function isCjkNameLike(text: string): boolean {
  return /^[\u4e00-\u9fff]{2,4}$/.test(text);
}

function startsWithKnownSurname(text: string): boolean {
  return REAL_COMPOUND_SURNAMES.some((surname) => text.startsWith(surname))
    || REAL_COMMON_SURNAMES.has(text[0]);
}

function isLikelyFrequentName(text: string): boolean {
  if (text.length < 2 || text.length > 4) return false;
  if (!isCjkNameLike(text)) return false;
  if (!startsWithKnownSurname(text)) return false;
  if (STOP_WORDS.has(text) || REAL_STOP_WORDS.has(text)) return false;
  if (ORG_SUFFIXES.has(text[text.length - 1])) return false;
  for (const ch of text) {
    if (BAD_CHARS.has(ch) || REAL_BAD_NAME_CHARS.has(ch)) return false;
  }
  return true;
}

function hasFrequentNameContext(text: string, start: number, length: number): boolean {
  const before = text.slice(Math.max(0, start - 2), start);
  const after = text.slice(start + length, start + length + 2);
  const window = before + after;

  for (const ch of window) {
    if (REAL_CHARACTER_CONTEXT_CHARS.has(ch)) return true;
  }

  const around = text.slice(Math.max(0, start - 6), start + length + 6);
  return DIALOGUE_VERBS.some((verb) => around.includes(verb))
    || TITLES.some((title) => around.includes(title));
}

export interface FrequentCharacterScanOptions {
  minMentions?: number;
  maxCandidates?: number;
}

/**
 * Discover high-frequency character names across the whole book.
 *
 * The per-chapter scanner is intentionally strict. This second pass catches
 * recurring roles that lack dialogue/title context, then lets importance
 * routing remove low-value leftovers before final output.
 */
export function scanFrequentCharacterEntities(
  chapters: ScanChapter[],
  options: FrequentCharacterScanOptions = {}
): EntityMention[] {
  const { minMentions = 5, maxCandidates = 160 } = options;
  const candidates = new Map<string, {
    count: number;
    firstChapter: number;
    firstPosition: number;
    chapters: Set<number>;
  }>();

  for (const chapter of chapters) {
    const text = chapter.content;
    for (let i = 0; i < text.length; i++) {
      if (!/[\u4e00-\u9fff]/.test(text[i])) continue;

      for (const len of [4, 3, 2]) {
        const name = text.slice(i, i + len);
        if (name.length !== len || !isLikelyFrequentName(name)) continue;
        if (!hasFrequentNameContext(text, i, len)) continue;
        // 跳过组织名残片：候选名后紧跟 宗/家/族/门… 时，它是更长组织名的一部分
        // （如“云岚宗”被过滤后，len=2 的“云岚”仍会被抓 → 需在此拦截）
        if (i + len < text.length && ORG_SUFFIXES.has(text[i + len])) continue;

        const entry = candidates.get(name) || {
          count: 0,
          firstChapter: chapter.index,
          firstPosition: i,
          chapters: new Set<number>(),
        };
        entry.count++;
        entry.chapters.add(chapter.index);
        candidates.set(name, entry);
      }
    }
  }

  const eligible = [...candidates.entries()]
    .filter(([, info]) => info.count >= minMentions)
    .sort((a, b) => b[1].count - a[1].count || b[0].length - a[0].length);

  const removed = new Set<string>();
  for (const [name, info] of eligible) {
    for (const [other, otherInfo] of eligible) {
      if (name === other || !other.includes(name)) continue;

      if (name.length === 2 && other.length === 3 && other.startsWith(name) && otherInfo.count >= info.count * 0.8) {
        removed.add(name);
        break;
      }

      if (name.length >= 3 && name.length < other.length && info.count >= otherInfo.count * 0.8) {
        removed.add(other);
        continue;
      }

      if (name.length < other.length && otherInfo.count > info.count * 1.2) {
        removed.add(name);
        break;
      }
    }
  }

  return eligible
    .filter(([name]) => !removed.has(name))
    .slice(0, maxCandidates)
    .map(([text, info]) => {
      const chapterList = [...info.chapters].sort((a, b) => a - b);
      const confidence = Math.min(
        0.95,
        0.62 + Math.min(0.15, info.count / 80) + Math.min(0.18, chapterList.length / 40)
      );

      return {
        text,
        chapterIndex: info.firstChapter,
        position: info.firstPosition,
        source: 'regex',
        confidence,
        totalCount: info.count,
        allChapters: chapterList,
      };
    });
}

/** Build compound surname alternation pattern */
const COMPOUND_PATTERN = `(?:${COMPOUND_SURNAMES.map(escapeRegex).join('|')})`;

/** Single surname char class */
const SINGLE_SURNAMES = '赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏窦章苏潘范彭鲁韦昌马苗凤花方俞任袁柳酆鲍史唐费廉岑薛雷贺倪汤滕殷罗毕郝邬安常乐于时傅皮齐康伍余元卜顾孟平黄和穆萧尹姚邵湛汪祁毛禹狄米贝明臧计伏成戴宋茅庞熊纪舒屈项祝董梁杜阮蓝闵席季麻强贾路娄危江童颜郭梅盛林刁钟徐邱骆高夏蔡田樊胡凌霍虞万支柯咎管卢莫经房裘缪干解应宗丁宣贲邓单杭洪包诸左石崔吉钮龚程嵇邢滑裴陆荣翁荀羊於惠甄魏家封芮羿储靳汲邴糜松井段富巫乌焦巴弓牧隗山谷车侯宓蓬全郗班仰秋仲伊宫宁仇栾暴甘钭厉戎祖武符刘景詹束龙叶幸司韶郜黎蓟薄印宿白怀蒲邰从鄂索咸籍赖卓蔺屠蒙池乔阴郁胥能苍双闻莘党翟谭贡劳逄姬申扶堵冉宰郦雍却璩桑桂濮牛寿通边扈燕冀郏浦尚农温别庄晏柴瞿阎充慕连茹习宦艾鱼容向古易慎戈廖庾终暨居衡步都耿满弘匡国文寇广禄阙东殴殳沃利蔚越夔隆师巩厍聂晁勾敖融冷訾辛阚那简饶空曾毋沙乜养鞠须丰巢关蒯相查后荆红游竺权逯盖益桓公';

/** Punctuation/whitespace that can precede a name */
const PRECEDING = '，。！？；：、""\\s';

/**
 * Scan a single chapter for character name mentions.
 */
export function scanCharacterEntities(chapter: ScanChapter): EntityMention[] {
  const text = chapter.content;
  const mentions: EntityMention[] = [];
  const seen = new Set<string>();

  const addMention = (match: string, index: number, confidence: number) => {
    const trimmed = match.trim();
    if (!isLikelyFrequentName(trimmed)) return;
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

  // 1. Compound surname + given name (1 char) — highest confidence
  //    Use 1 char to avoid pulling in dialogue verbs
  const compoundRe = new RegExp(`${COMPOUND_PATTERN}[一-鿿]`, 'g');
  for (const m of text.matchAll(compoundRe)) {
    addMention(m[0], m.index!, 0.9);
  }

  // 2. "Name + dialogue verb" — compound surname, 1-char given name
  const dialogueVerbPattern = DIALOGUE_VERBS.map(escapeRegex).join('|');
  const nameDialogueRe = new RegExp(
    `(?:[${PRECEDING}])(${COMPOUND_PATTERN}[一-鿿])(?:${dialogueVerbPattern})`,
    'g'
  );
  for (const m of text.matchAll(nameDialogueRe)) {
    if (m[1]) addMention(m[1], m.index! + m[0].indexOf(m[1]), 0.85);
  }

  // 2b. Single surname + 1-char name + dialogue verb
  const singleSurnameRe = new RegExp(
    `(?:[${PRECEDING}])([${SINGLE_SURNAMES}][一-鿿])(?:${dialogueVerbPattern})`,
    'g'
  );
  for (const m of text.matchAll(singleSurnameRe)) {
    const name = m[1];
    if (name && isLikelyName(name)) {
      addMention(name, m.index! + m[0].indexOf(name), 0.75);
    }
  }

  // 3. Self-introduction — must start with known surname
  const selfIntroRe = /(?:在下|吾乃|我是|我叫|本座|本尊|贫道|贫僧)([一-鿿]{2,4})(?=[，。！？；：、""\s]|$)/g;
  for (const m of text.matchAll(selfIntroRe)) {
    const name = m[1];
    if (isLikelyName(name)) {
      // Must start with a known surname to be a name (not a description like "苦主")
      const firstChar = name[0];
      if (COMPOUND_SURNAMES.some(s => name.startsWith(s)) || SINGLE_SURNAMES.includes(firstChar)) {
        addMention(name, m.index! + m[0].indexOf(name), 0.85);
      }
    }
  }

  // 4. Name + Title (e.g. "许七安大人")
  const titlePattern = TITLES.map(escapeRegex).join('|');
  const nameTitleRe = new RegExp(
    `(${COMPOUND_PATTERN}[一-鿿])(?:${titlePattern})`,
    'g'
  );
  for (const m of text.matchAll(nameTitleRe)) {
    if (m[1]) addMention(m[1], m.index!, 0.75);
  }

  // 5. Quote attribution: "……"XXX说/道 — only with surname validation
  const quoteAttrRe = /[""][^""]{1,100}[""]\s*([一-鿿]{2,3})(?:说道|道|曰|言|怒道|笑道|喝道)/g;
  for (const m of text.matchAll(quoteAttrRe)) {
    const name = m[1];
    // Must start with a known surname
    const firstChar = name[0];
    if (COMPOUND_SURNAMES.some(s => name.startsWith(s)) || SINGLE_SURNAMES.includes(firstChar)) {
      addMention(name, m.index! + m[0].indexOf(name), 0.7);
    }
  }

  return mentions;
}
