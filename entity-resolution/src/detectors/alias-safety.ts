import type { Character } from '../types.js';
import { isSameChineseName, normalizeChineseName } from './same-chinese-name.js';
import { normalizeName } from './same-name.js';
import { isKinshipEquivalentName } from '../kinship.js';

type CharacterInput = Omit<Character, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>;

const BARE_KINSHIP_TERMS = [
  '父亲',
  '母亲',
  '爸爸',
  '妈妈',
  '爹',
  '娘',
  '爷爷',
  '奶奶',
  '外公',
  '外婆',
  '哥哥',
  '姐姐',
  '弟弟',
  '妹妹',
  '哥',
  '姐',
  '弟',
  '妹',
  '叔叔',
  '叔',
  '婶婶',
  '婶',
  '伯父',
  '伯伯',
  '大伯',
  '二叔',
  '舅舅',
  '姑姑',
  '姑妈',
  '姑父',
  '阿姨',
  '姨',
  '姨妈',
  '姨父',
  '嫂子',
  '堂哥',
  '堂姐',
  '堂弟',
  '堂妹',
  '表哥',
  '表姐',
  '表弟',
  '表妹',
] as const;

const BARE_KINSHIP_ALIASES = new Set<string>(BARE_KINSHIP_TERMS);
const NUMBERED_TITLE_RE = /^[大二三四五六七八九十]+长老$/u;
const SCOPED_NUMBERED_TITLE_RE = /^[\u4e00-\u9fff]{1,10}[家族宗门阁派宫府院帮会教](?:族|门|院)?[大二三四五六七八九十]+长老$/u;
const ORG_SCOPE_RE = /[\u4e00-\u9fff]{1,10}(?:家族|宗门|学院|家|族|宗|门|阁|派|宫|府|院|帮|会|教)/gu;

/** 别名长度上限：超过几乎必是叙述片段而非称呼 */
const MAX_ALIAS_LENGTH = 10;
/** 单个别名数量上限：只保留真正常用的称呼，防止别名失控堆积 */
const MAX_ALIASES_PER_CHARACTER = 12;

const GENERIC_CHARACTER_ALIASES = new Set([
  // Pronouns — these refer to no one specifically
  '他',
  '她',
  '它',
  '他（',
  '她（',
  // Pronouns — these refer to no one specifically
  '他',
  '她',
  '它',
  '他（',
  '她（',
  // Generic role descriptors
  '女人',
  '男人',
  '此人',
  '那人',
  '家伙',
  '这家伙',
  '这小子',
  '那家伙',
  '这厮',
  '那厮',
  '小厮',
  '她',
  // Organizational titles
  '大长老',
  '二长老',
  '三长老',
  '四长老',
  '五长老',
  '六长老',
  '七长老',
  '八长老',
  '九长老',
  '十长老',
  '长老',
  '族长',
  '家主',
  '宗主',
  '护法',
  '管家',
  '队长',
  '护卫',
  '导师',
  '老师',
  '师父',
  '师傅',
  '先生',
  '老先生',
  '小姐',
  '少爷',
  '大人',
  '父亲',
  '母亲',
  '父王',
  '母后',
  '爹',
  '娘',
  '爸爸',
  '妈妈',
  '爷爷',
  '奶奶',
  '外公',
  '外婆',
  '哥哥',
  '姐姐',
  '弟弟',
  '妹妹',
  '哥',
  '姐',
  '弟',
  '妹',
  '叔叔',
  '叔',
  '婶婶',
  '婶',
  '伯父',
  '伯伯',
  '大伯',
  '二叔',
  '舅舅',
  '姑姑',
  '姑妈',
  '姑父',
  '阿姨',
  '姨妈',
  '姨父',
  '嫂子',
  '堂哥',
  '堂姐',
  '堂弟',
  '堂妹',
  '表哥',
  '表姐',
  '表弟',
  '表妹',
  '侄子',
  '侄女',
  '少年',
  '少女',
  '小家伙',
  '小崽子',
  '小混蛋',
  '小丫头',
  '妮子',
  '丫头',
  '老头',
  '黑袍人',
  '侍女',
]);

const KNOWN_ALIAS_PAIRS = new Set([
  aliasPairKey('许七安', '许宁宴'),
  aliasPairKey('许平志', '许二叔'),
  aliasPairKey('许新年', '许二郎'),
  aliasPairKey('陈汉光', '陈府尹'),
  aliasPairKey('魏渊', '魏公'),
]);
const COMMON_SURNAMES = new Set(Array.from(
  '赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳鲍史唐费廉岑薛雷贺倪汤滕殷罗毕安常乐于傅皮齐康伍余元卜顾孟平黄和穆萧尹姚邵汪祁毛禹狄米贝明计伏成戴宋茅庞熊纪舒屈项祝董梁杜阮蓝闵席季麻强贾路娄江童颜郭梅盛林钟徐邱骆高夏蔡田樊胡凌霍虞万支柯管卢莫解应宗丁宣邓单杭洪包左石崔吉龚程邢陆荣翁荀羊惠甄魏封靳松井段富巫焦巴牧山谷车侯全班秋仲宫宁仇甘厉祖武符刘景龙叶司黎薄白蒲燕尚温庄晏柴瞿阎充慕连习艾鱼容向古易戈廖终居衡耿满弘国文广东越师聂辛阚简饶曾沙养关盖益桓公'
));

const COMPOUND_SURNAMES = [
  '欧阳',
  '司马',
  '上官',
  '诸葛',
  '东方',
  '西门',
  '南宫',
  '公孙',
  '慕容',
  '令狐',
  '皇甫',
  '宇文',
  '长孙',
  '夏侯',
  '纳兰',
  '加列',
  '奥巴',
];

const ADDRESS_SUFFIXES = [
  '少爷',
  '小姐',
  '大人',
  '哥哥',
  '姐姐',
  '弟弟',
  '妹妹',
  '小弟弟',
  '小妹妹',
  '叔叔',
  '伯伯',
  '哥',
  '弟',
  '姐',
  '妹',
  '叔',
  '姨',
  '公',
  '婆',
  '爷',
  '奶',
  '儿',
  '郎',
  '娘',
  '姑',
].sort((a, b) => b.length - a.length);

const COLLECTIVE_ROLE_QUANTIFIERS = [
  '一位',
  '两位',
  '二位',
  '三位',
  '四位',
  '五位',
  '六位',
  '七位',
  '八位',
  '九位',
  '十位',
  '几位',
  '数位',
  '多位',
  '一名',
  '两名',
  '二名',
  '三名',
  '四名',
  '五名',
  '六名',
  '七名',
  '八名',
  '九名',
  '十名',
  '几名',
  '数名',
  '多名',
  '一个',
  '两个',
  '二个',
  '三个',
  '四个',
  '五个',
  '六个',
  '七个',
  '八个',
  '九个',
  '十个',
  '几个',
  '数个',
  '多个',
  '诸位',
  '各位',
  '众',
  '一众',
  '三大',
  '两大',
  '四大',
  '五大',
  '六大',
  '七大',
  '八大',
];

const COLLECTIVE_ROLE_NOUNS = [
  '长老',
  '老者',
  '导师',
  '护卫',
  '侍女',
  '弟子',
  '族人',
  '少年',
  '少女',
  '新生',
  '学员',
  '佣兵',
  '军官',
  '强者',
  '炼药师',
  '客人',
  '贵客',
  '族老',
  '长辈',
  '女人',
  '男人',
  '之人',
  '师叔',
  '师伯',
  '师尊',
  '师兄弟',
  '同门',
  '护法',
  '堂主',
  '高手',
  '强者',
  '修士',
  '道人',
  '僧人',
  '父母',
  '双亲',
  '兄弟',
  '姐妹',
  '兄妹',
  '姐弟',
  '父子',
  '母女',
  '爷孙',
  '夫妻',
  '夫妇',
  '婆媳',
  '叔侄',
];

// 预编译的集合称谓单一正则：量词×名词原先在嵌套循环里逐对 new RegExp（每个候选
// 最多 ~2400 次编译+测试），fallback 扫描全书逐字取候选时是天文数字，必须合并。
// 语义等价：原模式 ^[汉字]{0,8}Q[汉字]{0,4}R$ 的存在性判断 ⇔ 交替模式的可匹配性。
const COLLECTIVE_ALIAS_RE = new RegExp(
  `^[\\u4e00-\\u9fff]{0,8}(?:${COLLECTIVE_ROLE_QUANTIFIERS.join('|')})`
    + `[\\u4e00-\\u9fff]{0,4}(?:${COLLECTIVE_ROLE_NOUNS.join('|')})$`
);
// 裸亲属词命中检测（用于 fallback 候选过滤，等价于 BARE_KINSHIP_TERMS 逐个 includes）
const BARE_KINSHIP_TERM_RE = new RegExp(BARE_KINSHIP_TERMS.join('|'));

function aliasPairKey(a: string, b: string): string {
  return [normalizeForAliasSafety(a), normalizeForAliasSafety(b)].sort().join('|');
}

function normalizeForAliasSafety(name: string): string {
  return normalizeChineseName(name).replace(/薰/g, '熏').toLowerCase();
}

function isKnownAliasPair(a: string, b: string): boolean {
  return KNOWN_ALIAS_PAIRS.has(aliasPairKey(a, b));
}

function stripDemonstrative(alias: string): string {
  return alias
    .trim()
    .replace(/^(那位|这位|那个|这个|那名|这名|一位|一名|那|这)/, '');
}

function canonicalizeDemonstrativeAlias(alias: string): string {
  const stripped = stripDemonstrative(alias);
  return stripped.length >= 2 && !isGenericCharacterAlias(stripped) ? stripped : alias.trim();
}

export function isCollectiveCharacterAlias(alias: string): boolean {
  const normalized = alias.trim();
  if (!normalized) return false;
  if (/(他们|她们|它们)$/.test(normalized)) return true;
  // 本身即复数的亲属/关系称谓，无需量词前缀（如"韩立父母""X师兄弟"）
  if (normalized.length <= 8 && /(父母|双亲|爹娘|二老|全家|一家人|师兄弟|同门师兄弟)$/.test(normalized)) return true;

  return COLLECTIVE_ALIAS_RE.test(normalized);
}

export function isGenericCharacterAlias(alias: string): boolean {
  const normalized = alias.trim();
  const stripped = stripDemonstrative(normalized);
  if (GENERIC_CHARACTER_ALIASES.has(normalized) || GENERIC_CHARACTER_ALIASES.has(stripped)) return true;
  if (isCollectiveCharacterAlias(normalized)) return true;
  // Pronoun pattern
  if (/^[他她它](?:[^一-鿿]|$)/.test(normalized)) return true;
  if (/^[他她它][一-鿿]{0,3}$/.test(normalized)) return true;
  // Generic noun suffixes
  if (/女人|男人|之人|家伙/.test(normalized)) return true;
  // Generic appearance: 颜色+衣/裙/衫/袍+女/男/子
  if (/^(?:绿|红|青|蓝|白|黑|黄|紫|金|粉)[衣裙衫袍]+(?:女子|少女|少妇|男子|少年|子)$/.test(normalized)) return true;
  // Age-prefix generic: 中年/青年/老年 + generic role
  if (/^(?:中年|青年|老年|少年|壮年)(?:军官|教官|护卫|护卫|战士|男子|女子|少女|少年|人物|人士|中年人|青年人)$/.test(normalized)) return true;
  // Descriptor + generic person: 金星的青年, 白袍老者, etc.
  if (/^(?:金|银|红|蓝|绿|青|黑|白|黄)[星光色影线纹的]*(?:青年|少年|少女|老者|中年|男子|女子|子|人|人士)$/.test(normalized)) return true;
  // Insulting/derogatory generic descriptions
  if (/白痴|傻子|废物|蠢货|王八蛋|混蛋/.test(normalized)) return true;
  // Generic standalone roles
  if (/^(?:军官|教官|护卫|护士|医师|道士|青年|中年|老年)$/.test(normalized)) return true;
  if (/^[大二三四五六七八九十]+长老$/.test(normalized)) return true;
  if (/^[大小二三四五六七八九十]+(少爷|小姐)$/.test(normalized)) return true;
  return false;
}

function isBareKinshipAlias(name: string): boolean {
  return BARE_KINSHIP_ALIASES.has(stripDemonstrative(name.trim()));
}

function isBareNumberedTitle(name: string): boolean {
  const normalized = name.trim();
  return NUMBERED_TITLE_RE.test(normalized) && !SCOPED_NUMBERED_TITLE_RE.test(normalized);
}

function isScopedNumberedTitle(name: string): boolean {
  return SCOPED_NUMBERED_TITLE_RE.test(name.trim());
}

function isScopedKinshipName(name: string): boolean {
  const normalized = name.trim();
  return BARE_KINSHIP_TERMS.some((term) =>
    normalized.endsWith(`的${term}`) && normalized.length > term.length + 1
  );
}

function compactOrganizationScope(rawScope: string): string {
  let scope = rawScope
    .trim()
    .replace(/^(?:我们|咱们|他们|她们|你们|本|该|这个|那个|这些|那些|所有|几位|各位|在|现在|而|可|但|因为|所以)+/u, '');

  const familySuffix = scope.endsWith('家族') ? '家族' : scope.endsWith('家') ? '家' : '';
  if (familySuffix) {
    const root = scope.slice(0, -familySuffix.length);
    const compound = COMPOUND_SURNAMES.find((surname) => root.endsWith(surname));
    if (compound) return `${compound}${familySuffix}`;
    const last = root.at(-1);
    if (last && COMMON_SURNAMES.has(last)) return `${last}${familySuffix}`;
  }

  return scope.length > 8 ? scope.slice(-8) : scope;
}

function sourceOccurrences(sourceText: string | undefined, value: string): number[] {
  const positions: number[] = [];
  if (!sourceText || !value) return positions;

  let index = sourceText.indexOf(value);
  while (index !== -1) {
    positions.push(index);
    index = sourceText.indexOf(value, index + value.length);
  }
  return positions;
}

// 裸称号（如"三长老"）范围推断的引用缓存，理由同亲属称谓缓存
const scopedNumberedTitleCache: { text?: string; results?: Map<string, string | undefined> } = {};

function inferScopedNumberedTitle(name: string, sourceText: string | undefined): string | undefined {
  const normalized = name.trim();
  if (!sourceText || !isBareNumberedTitle(normalized)) return undefined;
  if (scopedNumberedTitleCache.text !== sourceText) {
    scopedNumberedTitleCache.text = sourceText;
    scopedNumberedTitleCache.results = new Map();
  }
  const cached = scopedNumberedTitleCache.results!.get(normalized);
  if (cached !== undefined) return cached;

  // 同一 scope 在多个称号出现位置会反复计数，做本次调用内的记忆化
  const scopeCountCache = new Map<string, number>();

  let bestScope: string | undefined;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const titleIndex of sourceOccurrences(sourceText, normalized)) {
    const start = Math.max(0, titleIndex - 140);
    const end = Math.min(sourceText.length, titleIndex + normalized.length + 140);
    const window = sourceText.slice(start, end);

    for (const match of window.matchAll(ORG_SCOPE_RE)) {
      const scope = compactOrganizationScope(match[0]);
      if (!scope || scope.length < 2) continue;

      let scopeCount = scopeCountCache.get(scope);
      if (scopeCount === undefined) {
        scopeCount = countOccurrences(sourceText, scope);
        scopeCountCache.set(scope, scopeCount);
      }

      const absoluteIndex = start + (match.index ?? 0);
      const distance = Math.abs(titleIndex - absoluteIndex);
      const score = scopeCount * 20 - distance;
      if (score > bestScore) {
        bestScore = score;
        bestScope = scope;
      }
    }
  }

  const result = bestScope ? `${bestScope}${normalized}` : undefined;
  scopedNumberedTitleCache.results!.set(normalized, result);
  return result;
}

/** 评分时（名字位置×关系位置）配对评估的硬上限，防御高频词密集共现的病态文本 */
const MAX_KINSHIP_PAIR_EVALS = 200_000;

function scoreKnownNameForKinship(
  sourceText: string,
  knownName: string,
  relation: string,
  relationPositions: number[]
): number {
  const namePositions = sourceOccurrences(sourceText, knownName);
  if (namePositions.length === 0) return Number.NEGATIVE_INFINITY;

  let score = namePositions.length * 20;
  let adjacent = false;
  let adjacentWithDe = false;
  let pairEvals = 0;
  // 双指针：两组位置均为升序，只考察距离 ≤160 的配对。
  // 原实现是全量笛卡尔积（关系词 × 名字的所有出现位置），长书上是天文数字。
  let left = 0;
  for (const namePos of namePositions) {
    while (left < relationPositions.length && relationPositions[left] < namePos - 160) left++;
    for (let k = left; k < relationPositions.length && relationPositions[k] <= namePos + 160; k++) {
      const relationPos = relationPositions[k];
      const distance = Math.abs(relationPos - namePos);
      if (distance > 160) continue;
      if (pairEvals++ < MAX_KINSHIP_PAIR_EVALS) {
        score += namePos < relationPos
          ? 220 - distance
          : Math.max(0, 40 - Math.floor(distance / 2));
      }
      // 紧邻判定直接用位置数组完成，替代两次全书 includes 扫描
      if (relationPos === namePos + knownName.length) adjacent = true;
      if (
        relationPos === namePos + knownName.length + 1
        && sourceText[namePos + knownName.length] === '的'
      ) {
        adjacentWithDe = true;
      }
    }
  }
  if (adjacent) score += 300;
  if (adjacentWithDe) score += 260;

  return score;
}

/** fallback 候选上限：全书逐字扫描出的「疑似人名」只保留高频前 N 个，
 *  防止百万字级文本把后续逐候选全书评分拖垮（低频名本来也评不上亲属归属） */
const MAX_FALLBACK_NAME_CANDIDATES = 200;
// 单条引用缓存：提取流程用同一 sourceText 引用逐角色反复调用，命中后零成本
const fallbackNamesCache: { text?: string; names?: string[] } = {};

function fallbackKnownCharacterNames(sourceText: string): string[] {
  if (fallbackNamesCache.text === sourceText && fallbackNamesCache.names) {
    return fallbackNamesCache.names;
  }

  const counts = new Map<string, number>();
  for (let i = 0; i < sourceText.length; i++) {
    for (const length of [3, 2]) {
      const candidate = sourceText.slice(i, i + length);
      if (candidate.length !== length) continue;
      if (/^(和|与|及|在|有|是|这|那|他|她)/u.test(candidate)) continue;
      if (/[和与及在是有觉想说看拿走]$/u.test(candidate)) continue;
      if (candidate.includes('觉得')) continue;
      if (BARE_KINSHIP_TERM_RE.test(candidate)) continue;
      if (isLikelyProperChineseName(candidate)) {
        counts.set(candidate, (counts.get(candidate) ?? 0) + 1);
      }
    }
  }

  // 超过上限时按出现频次保留（同名次短者优先，再按字典序保证确定性），
  // 但输出保持书内首现顺序，与旧行为的候选次序一致
  const entries = [...counts.entries()];
  const kept = new Set(
    [...entries]
      .sort((a, b) => b[1] - a[1] || a[0].length - b[0].length || (a[0] < b[0] ? -1 : 1))
      .slice(0, MAX_FALLBACK_NAME_CANDIDATES)
      .map(([name]) => name),
  );
  const names = entries.filter(([name]) => kept.has(name)).map(([name]) => name);

  fallbackNamesCache.text = sourceText;
  fallbackNamesCache.names = names;
  return names;
}

// 亲属称谓归属推断的引用缓存：同一 sourceText 下同一称谓的结果不变。
// 键包含 knownCharacterNames 全量内容——只用长度的话，同长度不同内容的
// 两轮调用会串到彼此的陈旧结果（重跑同一本书时可复现）。
const scopedKinshipCache: { text?: string; results?: Map<string, string | undefined> } = {};

function inferScopedKinshipName(
  name: string,
  sourceText: string | undefined,
  knownCharacterNames: string[] = []
): string | undefined {
  if (!sourceText || !isBareKinshipAlias(name)) return undefined;
  if (scopedKinshipCache.text !== sourceText) {
    scopedKinshipCache.text = sourceText;
    scopedKinshipCache.results = new Map();
  }
  const cacheKey = `${name.trim()}\u0000${knownCharacterNames.join('\u0001')}`;
  const cached = scopedKinshipCache.results!.get(cacheKey);
  if (cached !== undefined) return cached;

  const relation = stripDemonstrative(name.trim());
  const relationPositions = sourceOccurrences(sourceText, relation);
  const candidateNames = [...new Set([
    ...knownCharacterNames,
    ...fallbackKnownCharacterNames(sourceText),
  ])];

  for (const knownName of candidateNames) {
    const cleanName = knownName.trim();
    if (!cleanName) continue;
    if (sourceText.includes(`${cleanName}${relation}`)) {
      const result = `${cleanName}的${relation}`;
      scopedKinshipCache.results!.set(cacheKey, result);
      return result;
    }
    if (sourceText.includes(`${cleanName}的${relation}`)) {
      const result = `${cleanName}的${relation}`;
      scopedKinshipCache.results!.set(cacheKey, result);
      return result;
    }
  }

  let bestName: string | undefined;
  let bestScore = Number.NEGATIVE_INFINITY;
  const explicitKnownNames = new Set(knownCharacterNames.map((knownName) => knownName.trim()).filter(Boolean));
  for (const knownName of candidateNames) {
    const cleanName = knownName.trim();
    if (!cleanName || cleanName === relation || isGenericCharacterAlias(cleanName)) continue;
    if (candidateNames.some((otherName) =>
      otherName !== cleanName
      && otherName.length > cleanName.length
      && otherName.includes(cleanName)
    )) {
      continue;
    }
    const score = scoreKnownNameForKinship(sourceText, cleanName, relation, relationPositions)
      + (explicitKnownNames.has(cleanName) ? 1000 : 0);
    if (score > bestScore) {
      bestScore = score;
      bestName = cleanName;
    }
  }

  const result = bestName && bestScore > Number.NEGATIVE_INFINITY
    ? `${bestName}的${relation}`
    : undefined;
  scopedKinshipCache.results!.set(cacheKey, result);
  return result;
}

function isInferredCanonicalNameCompatible(candidate: string, originalName: string): boolean {
  const normalizedCandidate = candidate.trim();
  const normalizedOriginal = originalName.trim();
  if (isScopedNumberedTitle(normalizedCandidate) && isBareNumberedTitle(normalizedOriginal)) {
    return normalizedCandidate.endsWith(normalizedOriginal);
  }
  if (isScopedKinshipName(normalizedCandidate) && isBareKinshipAlias(normalizedOriginal)) {
    return normalizedCandidate.endsWith(`的${stripDemonstrative(normalizedOriginal)}`);
  }
  return false;
}

function isNarrativeAliasFragment(alias: string): boolean {
  const normalized = alias.trim();
  if (!normalized) return false;
  if (BARE_KINSHIP_TERMS.some((term) => normalized.startsWith(term) && normalized.length > term.length + 2)) {
    return true;
  }
  if (normalized.length > 12 && /[左右]手|手机|打火机|说道|看见|望着|拿着|走进|走出|跑去|买了|觉得|正在|忽然/u.test(normalized)) {
    return true;
  }
  return false;
}

function startsWithKnownSurname(name: string): boolean {
  return COMPOUND_SURNAMES.some((surname) => name.startsWith(surname))
    || COMMON_SURNAMES.has(name[0]);
}

function isLikelyProperChineseName(name: string): boolean {
  const normalized = name.trim();
  return /^[\u4e00-\u9fff]{2,4}$/.test(normalized)
    && startsWithKnownSurname(normalized)
    && !isGenericCharacterAlias(normalized);
}

function isNameScopedAddress(alias: string): boolean {
  const normalized = alias.trim();
  return startsWithKnownSurname(normalized)
    && /(族长|家主|宗主|长老|先生|老师|师父|师傅|叔叔|叔|伯父|伯伯|少爷|小姐|大人|父亲|母亲)$/.test(normalized);
}

/**
 * 姓氏剥离变体检测：判断两个名字是否满足「长名去掉常见姓氏开头后等于短名」
 * （如 宁荣荣→荣荣、萧薰儿→薰儿）。昵称截断是同一人物的强信号，
 * 但本函数只负责生成合并候选，最终是否合并由 LLM 裁决/人工确认。
 *
 * 约束（控制误报）：
 * - 直接比较原始名字（不做称谓归一——normalizeChineseName 会剥掉「薰儿」的
 *   「儿」后缀，反而破坏变体关系；带称谓的变体由 isSameChineseName 单独覆盖）；
 * - 两边须是 2-4 字纯中文；
 * - 长名必须以常见姓氏（含复姓）开头，剥离后剩余 ≥2 字；
 * - 短名不能是泛称（如「老师」「夫人」），避免头衔撞名。
 */
export function isSurnameStrippedNameVariant(a: string, b: string): boolean {
  const na = a.trim();
  const nb = b.trim();
  if (na === nb || na.length === nb.length) return false;
  if (!/^[\u4e00-\u9fff]{2,4}$/.test(na) || !/^[\u4e00-\u9fff]{2,4}$/.test(nb)) return false;

  const longer = na.length > nb.length ? na : nb;
  const shorter = na.length > nb.length ? nb : na;
  if (shorter.length < 2) return false;
  if (isGenericCharacterAlias(shorter) || isGenericCharacterAlias(longer)) return false;

  // 复姓优先（如 慕容紫英 → 紫英 ✓；慕容复 → 复 剩余 1 字不满足）
  for (const surname of COMPOUND_SURNAMES) {
    if (longer.startsWith(surname) && longer.slice(surname.length) === shorter) {
      return true;
    }
  }
  // 单姓剥离（宁荣荣 → 荣荣、萧薰儿 → 薰儿）
  return COMMON_SURNAMES.has(longer[0]) && longer.slice(1) === shorter;
}

/**
 * 两个名字互为「去姓变体」时，返回更适合作正名的那个（带姓氏的更长名字，
 * 如 宁荣荣 > 荣荣）；不是变体对返回 null（由调用方按原有顺序处理）。
 */
export function pickCanonicalName(a: string, b: string): string | null {
  if (!isSurnameStrippedNameVariant(a, b)) return null;
  return a.trim().length > b.trim().length ? a.trim() : b.trim();
}

/** 称谓后缀表（长在前优先匹配）：与正名/其他别名只差一个称谓后缀的别名视为冗余 */
const HONORIFIC_SUFFIXES = [
  '小姐', '姑娘', '少爷', '公子', '大人', '先生', '女士', '夫人', '太太', '殿下', '陛下',
  '哥', '姐', '弟', '妹', '兄', '叔', '姨',
];

/**
 * 同实体内别名降噪：去掉「正名/其他别名 + 称谓后缀」形态的冗余别名
 * （如已有 宁荣荣 时删掉 宁荣荣小姐、宁荣荣姑娘；已有 荣荣 时删掉 荣荣姐）。
 * 只动纯冗余项；头衔型别名（九彩斗罗、七宝琉璃塔魂师）与无基座的称谓保留。
 */
export function dropRedundantHonorificAliases(name: string, aliases: string[]): string[] {
  const bases = new Set([name.trim(), ...aliases.map((a) => a.trim())].filter(Boolean));
  return aliases.filter((alias) => {
    const a = alias.trim();
    for (const suffix of HONORIFIC_SUFFIXES) {
      const base = a.slice(0, a.length - suffix.length);
      // 剥离后剩余 ≥2 字才处理，避免「阿宁小姐→阿宁」这类把姓氏单字当基座的误删
      if (a.length - suffix.length >= 2 && a.endsWith(suffix) && bases.has(base)) {
        return false;
      }
    }
    return true;
  });
}

function isCompatibleAlias(alias: string, ownerName: string, targetName: string): boolean {
  if (isGenericCharacterAlias(alias)) return false;
  if (isSameChineseName(ownerName, targetName)) return true;
  if (isKnownAliasPair(ownerName, targetName)) return true;

  const ownerLooksProper = isLikelyProperChineseName(ownerName);
  const targetLooksProper = isLikelyProperChineseName(targetName);
  if (ownerLooksProper && targetLooksProper) {
    return false;
  }

  return true;
}

function aliasOwnershipRoot(value: string): string {
  let normalized = value.trim().replace(/薰/g, '熏');
  for (const prefix of ['老', '小', '阿']) {
    if (normalized.startsWith(prefix) && normalized.length > prefix.length) {
      normalized = normalized.slice(prefix.length);
      break;
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of ADDRESS_SUFFIXES) {
      if (normalized.endsWith(suffix) && normalized.length > suffix.length) {
        normalized = normalized.slice(0, normalized.length - suffix.length);
        changed = true;
        break;
      }
    }
  }

  return normalized;
}

function isPersonalAddressAlias(alias: string): boolean {
  const normalized = alias.trim();
  return ADDRESS_SUFFIXES.some((suffix) => normalized.endsWith(suffix) && normalized.length > suffix.length)
    || ['老', '小', '阿'].some((prefix) => normalized.startsWith(prefix) && normalized.length > prefix.length);
}

function isAliasCompatibleWithCharacterName(alias: string, characterName: string): boolean {
  if (isSameChineseName(alias, characterName)) return true;
  if (isKnownAliasPair(alias, characterName)) return true;
  // 亲属称谓变体（"X的妈妈"≡"X的母亲"）指同一人，视为兼容；
  // 所有权词根提取对两者不对称（妈妈在称呼后缀表、母亲不在），不补这条会误判为他人别名
  if (isKinshipEquivalentName(alias, characterName)) return true;

  const aliasRoot = aliasOwnershipRoot(alias);
  const nameRoot = aliasOwnershipRoot(characterName);
  if (!aliasRoot || !nameRoot) return false;
  return aliasRoot === nameRoot
    || (aliasRoot.length >= 1 && nameRoot.endsWith(aliasRoot))
    || (nameRoot.length >= 1 && aliasRoot.endsWith(nameRoot));
}

function belongsToAnotherKnownCharacter(
  alias: string,
  characterName: string,
  knownCharacterNames: string[] = [],
  knownAliasesByCharacter: Record<string, string[]> = {}
): boolean {
  if (isAliasCompatibleWithCharacterName(alias, characterName)) return false;

  return knownCharacterNames.some((knownName) => {
    if (isAliasCompatibleWithCharacterName(knownName, characterName)) return false;
    if (isAliasCompatibleWithCharacterName(alias, knownName)) return true;

    return (knownAliasesByCharacter[knownName] || []).some((knownAlias) =>
      isNameScopedTitleOwnerAlias(alias, knownAlias, knownName)
    );
  });
}

function isNameScopedTitleOwnerAlias(alias: string, ownerAlias: string, ownerName: string): boolean {
  const normalizedAlias = alias.trim();
  const normalizedOwnerAlias = ownerAlias.trim();
  if (
    normalizedAlias.length < 2
    || normalizedOwnerAlias === normalizedAlias
    || !normalizedOwnerAlias.includes(ownerName)
  ) {
    return false;
  }

  return normalizedOwnerAlias.startsWith(normalizedAlias)
    || normalizedOwnerAlias.endsWith(normalizedAlias);
}

export interface SanitizeCharacterAliasesOptions {
  sourceText?: string;
  knownCharacterNames?: string[];
  knownAliasesByCharacter?: Record<string, string[]>;
}

function countOccurrences(sourceText: string | undefined, value: string): number {
  if (!sourceText || !value) return 0;
  let count = 0;
  let index = sourceText.indexOf(value);
  while (index !== -1) {
    count++;
    index = sourceText.indexOf(value, index + value.length);
  }
  return count;
}

function hasDisallowedCanonicalAddressSuffix(name: string): boolean {
  return ADDRESS_SUFFIXES.some((suffix) =>
    suffix !== '儿'
    && suffix !== '郎'
    && name.endsWith(suffix)
    && name.length > suffix.length
  );
}

function isCanonicalNameCandidate(name: string): boolean {
  const normalized = name.trim();
  if (isScopedNumberedTitle(normalized) || isScopedKinshipName(normalized)) return true;
  return isLikelyProperChineseName(normalized)
    && !isNameScopedAddress(normalized)
    && !hasDisallowedCanonicalAddressSuffix(normalized);
}

function canonicalNameScore(name: string, sourceText?: string): number {
  return name.length * 10 + countOccurrences(sourceText, name);
}

export function chooseCanonicalCharacterName(
  characterName: string,
  aliases: string[] = [],
  options: Pick<SanitizeCharacterAliasesOptions, 'sourceText' | 'knownCharacterNames'> = {}
): string {
  const originalName = characterName.trim();
  let bestName = originalName;
  let bestScore = isCanonicalNameCandidate(originalName)
    ? canonicalNameScore(originalName, options.sourceText)
    : Number.NEGATIVE_INFINITY;

  const inferredFromOriginal = inferScopedKinshipName(
    originalName,
    options.sourceText,
    options.knownCharacterNames
  ) ?? inferScopedNumberedTitle(originalName, options.sourceText);

  if (inferredFromOriginal && isCanonicalNameCandidate(inferredFromOriginal)) {
    bestName = inferredFromOriginal;
    bestScore = canonicalNameScore(inferredFromOriginal, options.sourceText) + 1000;
  }

  for (const alias of aliases) {
    const rawCandidate = alias.trim();
    const candidate = inferScopedKinshipName(
      rawCandidate,
      options.sourceText,
      options.knownCharacterNames
    ) ?? inferScopedNumberedTitle(rawCandidate, options.sourceText) ?? rawCandidate;
    if (!candidate || !isCanonicalNameCandidate(candidate)) continue;
    if (
      !isAliasCompatibleWithCharacterName(candidate, originalName)
      && !isInferredCanonicalNameCompatible(candidate, originalName)
    ) continue;
    if (options.sourceText && !options.sourceText.includes(candidate)) continue;

    const score = canonicalNameScore(candidate, options.sourceText);
    if (score > bestScore) {
      bestName = candidate;
      bestScore = score;
    }
  }

  return bestName;
}

export function sanitizeCharacterAliases(
  characterName: string,
  aliases: string[] = [],
  options: SanitizeCharacterAliasesOptions = {}
): string[] {
  const seen = new Set<string>();
  const cleanAliases: string[] = [];
  const sourceText = options.sourceText;

  for (const alias of aliases) {
    const rawAlias = alias.trim();
    const normalized = canonicalizeDemonstrativeAlias(rawAlias);
    if (!normalized) continue;
    if (normalizeName(normalized) === normalizeName(characterName)) continue;
    if (seen.has(normalized)) continue;
    // 收紧：中文称呼不会包含空白或标点，含这些字符的是叙述片段而非别名；
    // 外文称呼（如 Jean Grey、Jean-Paul、O'Brien、A·B）是合法带分隔符名称，需放行。
    if (/[一-鿿]/.test(normalized)) {
      if (/[\s，。、；：！？“”‘’《》（）()…·,.:;!?"'\-]/.test(normalized)) continue;
    } else if (!/^[^\W\d_]+(?:[ '\-·.][^\W\d_]+)*$/u.test(normalized)) {
      // 非中文且不是「字母（分隔符字母）*」形态的，视为叙述片段
      continue;
    }
    // 收紧：超长别名几乎必是描述性片段，丢弃
    if (normalized.length > MAX_ALIAS_LENGTH) continue;
    if (isNarrativeAliasFragment(normalized)) continue;
    if (isGenericCharacterAlias(normalized)) continue;
    if (sourceText && !sourceText.includes(rawAlias) && !sourceText.includes(normalized)) continue;
    if (
      isLikelyProperChineseName(normalized)
      && isLikelyProperChineseName(characterName)
      && !isNameScopedAddress(normalized)
      && !isAliasCompatibleWithCharacterName(normalized, characterName)
    ) {
      continue;
    }
    if (
      isPersonalAddressAlias(normalized)
      && !isNameScopedAddress(normalized)
      && !isAliasCompatibleWithCharacterName(normalized, characterName)
    ) {
      continue;
    }
    if (
      belongsToAnotherKnownCharacter(
        normalized,
        characterName,
        options.knownCharacterNames,
        options.knownAliasesByCharacter
      )
    ) {
      continue;
    }
    // "X大人" where X is a generic title not scoped to the character → filter (e.g. "宗主大人" without entity context)
    // But keep scoped ones like "萧家族长" which has known role context
    if (/^[^一-鿿]+大人$/.test(normalized)) {
      const prefix = normalized.slice(0, -2);
      // If prefix doesn't match character name and doesn't look like a role-scoped title, filter
      if (prefix !== characterName && !isNameScopedAddress(prefix + '的')) continue;
    }

    seen.add(normalized);
    cleanAliases.push(normalized);
  }

  // 收紧：数量超限时优先保留更短的称呼（短称呼通常是更常用的名字）
  if (cleanAliases.length > MAX_ALIASES_PER_CHARACTER) {
    cleanAliases.sort((a, b) => a.length - b.length);
    cleanAliases.length = MAX_ALIASES_PER_CHARACTER;
  }

  return cleanAliases;
}

export function implicitCharacterSignalAliases(characterName: string): string[] {
  const normalized = characterName.trim();
  const aliases: string[] = [];

  const kinship = BARE_KINSHIP_TERMS.find((term) => normalized.endsWith(`的${term}`));
  if (kinship) aliases.push(kinship);

  if (isScopedNumberedTitle(normalized)) {
    const title = normalized.match(/[大二三四五六七八九十]+长老$/u)?.[0];
    if (title) aliases.push(title);
  }

  return [...new Set(aliases)];
}

export function isSafeAliasMatch(char1: CharacterInput, char2: CharacterInput): boolean {
  const name1Lower = normalizeName(char1.name);
  const name2Lower = normalizeName(char2.name);

  for (const alias of char1.aliases || []) {
    if (
      normalizeName(alias) === name2Lower
      && isCompatibleAlias(alias, char1.name, char2.name)
    ) {
      return true;
    }
  }

  for (const alias of char2.aliases || []) {
    if (
      normalizeName(alias) === name1Lower
      && isCompatibleAlias(alias, char2.name, char1.name)
    ) {
      return true;
    }
  }

  return false;
}

export function isSafeSharedAliasMatch(char1: CharacterInput, char2: CharacterInput): boolean {
  const aliases1 = new Set((char1.aliases || []).map(normalizeName));

  for (const alias of char2.aliases || []) {
    if (
      aliases1.has(normalizeName(alias))
      && isCompatibleAlias(alias, char1.name, char2.name)
      && isCompatibleAlias(alias, char2.name, char1.name)
    ) {
      return true;
    }
  }

  return false;
}
