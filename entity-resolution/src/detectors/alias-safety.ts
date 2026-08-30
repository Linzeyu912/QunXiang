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

  return COLLECTIVE_ROLE_QUANTIFIERS.some((quantifier) =>
    COLLECTIVE_ROLE_NOUNS.some((role) => {
      const pattern = new RegExp(`^[\\u4e00-\\u9fff]{0,8}${quantifier}[\\u4e00-\\u9fff]{0,4}${role}$`);
      return pattern.test(normalized);
    })
  );
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

function inferScopedNumberedTitle(name: string, sourceText: string | undefined): string | undefined {
  const normalized = name.trim();
  if (!sourceText || !isBareNumberedTitle(normalized)) return undefined;

  let bestScope: string | undefined;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const titleIndex of sourceOccurrences(sourceText, normalized)) {
    const start = Math.max(0, titleIndex - 140);
    const end = Math.min(sourceText.length, titleIndex + normalized.length + 140);
    const window = sourceText.slice(start, end);

    for (const match of window.matchAll(ORG_SCOPE_RE)) {
      const scope = compactOrganizationScope(match[0]);
      if (!scope || scope.length < 2) continue;

      const absoluteIndex = start + (match.index ?? 0);
      const distance = Math.abs(titleIndex - absoluteIndex);
      const score = countOccurrences(sourceText, scope) * 20 - distance;
      if (score > bestScore) {
        bestScore = score;
        bestScope = scope;
      }
    }
  }

  return bestScope ? `${bestScope}${normalized}` : undefined;
}

function scoreKnownNameForKinship(sourceText: string, knownName: string, relation: string): number {
  const occurrences = countOccurrences(sourceText, knownName);
  if (occurrences === 0) return Number.NEGATIVE_INFINITY;

  let score = occurrences * 20;
  if (sourceText.includes(`${knownName}${relation}`)) score += 300;
  if (sourceText.includes(`${knownName}的${relation}`)) score += 260;

  for (const relationIndex of sourceOccurrences(sourceText, relation)) {
    for (const nameIndex of sourceOccurrences(sourceText, knownName)) {
      const distance = Math.abs(relationIndex - nameIndex);
      if (distance > 160) continue;
      score += nameIndex < relationIndex
        ? 220 - distance
        : Math.max(0, 40 - Math.floor(distance / 2));
    }
  }

  return score;
}

function fallbackKnownCharacterNames(sourceText: string): string[] {
  const names: string[] = [];
  for (let i = 0; i < sourceText.length; i++) {
    for (const length of [3, 2]) {
      const candidate = sourceText.slice(i, i + length);
      if (candidate.length !== length) continue;
      if (/^(和|与|及|在|有|是|这|那|他|她)/u.test(candidate)) continue;
      if (/[和与及在是有觉想说看拿走]$/u.test(candidate)) continue;
      if (candidate.includes('觉得')) continue;
      if (BARE_KINSHIP_TERMS.some((term) => candidate.includes(term))) continue;
      if (isLikelyProperChineseName(candidate)) names.push(candidate);
    }
  }
  return [...new Set(names)];
}

function inferScopedKinshipName(
  name: string,
  sourceText: string | undefined,
  knownCharacterNames: string[] = []
): string | undefined {
  if (!sourceText || !isBareKinshipAlias(name)) return undefined;
  const relation = stripDemonstrative(name.trim());
  const candidateNames = [...new Set([
    ...knownCharacterNames,
    ...fallbackKnownCharacterNames(sourceText),
  ])];

  for (const knownName of candidateNames) {
    const cleanName = knownName.trim();
    if (!cleanName) continue;
    if (sourceText.includes(`${cleanName}${relation}`)) return `${cleanName}的${relation}`;
    if (sourceText.includes(`${cleanName}的${relation}`)) return `${cleanName}的${relation}`;
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
    const score = scoreKnownNameForKinship(sourceText, cleanName, relation)
      + (explicitKnownNames.has(cleanName) ? 1000 : 0);
    if (score > bestScore) {
      bestScore = score;
      bestName = cleanName;
    }
  }

  return bestName && bestScore > Number.NEGATIVE_INFINITY
    ? `${bestName}的${relation}`
    : undefined;
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
