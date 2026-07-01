import type { Character } from '../types.js';
import { isSameChineseName, normalizeChineseName } from './same-chinese-name.js';
import { normalizeName } from './same-name.js';

type CharacterInput = Omit<Character, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>;

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
  '伯父',
  '伯伯',
  '大伯',
  '二叔',
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
  options: Pick<SanitizeCharacterAliasesOptions, 'sourceText'> = {}
): string {
  const originalName = characterName.trim();
  let bestName = originalName;
  let bestScore = isCanonicalNameCandidate(originalName)
    ? canonicalNameScore(originalName, options.sourceText)
    : Number.NEGATIVE_INFINITY;

  for (const alias of aliases) {
    const candidate = alias.trim();
    if (!candidate || !isCanonicalNameCandidate(candidate)) continue;
    if (!isAliasCompatibleWithCharacterName(candidate, originalName)) continue;
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

  return cleanAliases;
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
