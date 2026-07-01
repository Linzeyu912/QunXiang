import type { Character, Item, Location } from '@novel-agent/core';

export interface DescriptionChapter {
  index: number;
  title?: string;
  content: string;
}

export type SourceCoverage = 'none' | 'partial' | 'strong';

export type CharacterDescriptionField =
  | 'appearance'
  | 'clothing'
  | 'body'
  | 'temperament'
  | 'signatureItems'
  | 'abilityVisuals'
  | 'statusMarkers';

export type ItemDescriptionField =
  | 'material'
  | 'colorShape'
  | 'condition'
  | 'usage'
  | 'visualEffects'
  | 'ownership';

export type LocationDescriptionField =
  | 'environment'
  | 'layout'
  | 'atmosphere'
  | 'lighting'
  | 'time'
  | 'actionContext';

export interface DescriptionEvidenceSnippet<Field extends string = string> {
  chapterIndex: number;
  chapterTitle?: string;
  text: string;
  matchedNames: string[];
  otherMatchedNames?: string[];
  fields: Field[];
}

export interface EntityDescriptionPack<EntityType extends string, Field extends string> {
  entityType: EntityType;
  name: string;
  aliases: string[];
  sourceDescription: string;
  fields: Record<Field, string>;
  missingFields: Field[];
  evidenceSnippets: DescriptionEvidenceSnippet<Field>[];
  sourceCoverage: SourceCoverage;
  confidence: number;
  needsReview: boolean;
  tier?: string;
  importanceScore?: number;
}

export type CharacterDescriptionPack = EntityDescriptionPack<'character', CharacterDescriptionField>;
export type ItemDescriptionPack = EntityDescriptionPack<'item', ItemDescriptionField>;
export type LocationDescriptionPack = EntityDescriptionPack<'location', LocationDescriptionField>;

type CharacterCandidate = Omit<Character, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>;
type ItemCandidate = Omit<Item, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>;
type LocationCandidate = Omit<Location, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>;
type EntityCandidate = { name: string; aliases?: string[] };
type FieldPattern<Field extends string> = { field: Field; re: RegExp };

const GENERIC_ALIASES = new Set([
  '他',
  '她',
  '此人',
  '此女',
  '对方',
  '那人',
  '这里',
  '此地',
  '本门',
  '门内',
  '谷',
  '谷内',
  '谷中',
  '山谷',
  '小山谷',
]);

const CHARACTER_FIELD_PATTERNS: Array<FieldPattern<CharacterDescriptionField>> = [
  {
    field: 'appearance',
    re: /(容貌|面容|脸庞|脸颊|脸色|小脸|俏脸|眉眼|眉毛|眸子|眼眸|瞳孔|唇|鼻|肌肤|皮肤|清秀|俊美|苍老|稚嫩|面孔)/u,
  },
  {
    field: 'clothing',
    re: /(身穿|穿着|一身|衣衫|衣袍|衣裙|衣服|长袍|黑袍|白衣|青衣|黄袍|裙|披风|盔甲|甲胄|黑色|白色|月白|青色|黄色|紫色|红色)/u,
  },
  {
    field: 'body',
    re: /(身材|身形|体型|肩背|背影|高大|瘦削|单薄|魁梧|矮小|修长|挺拔|佝偻)/u,
  },
  {
    field: 'temperament',
    re: /(神色|神情|气质|目光|眼神|平静|沉默|倔强|怒意|落寞|狰狞|清冷|冷漠|温和|阴沉|威严|从容|骄傲|傲然|狠厉|怯懦|坚毅)/u,
  },
  {
    field: 'signatureItems',
    re: /(戒指|古戒|玉佩|佩剑|长剑|短剑|刀|令牌|腰牌|项链|耳坠|面具|斗笠|药鼎|丹炉|卷轴)/u,
  },
  {
    field: 'abilityVisuals',
    re: /(斗气|灵气|真气|火焰|异火|雷光|剑光|刀光|光芒|黑雾|灵魂|斗技|功法|法力|法宝|气息|气势|威压|翻涌|爆发|缭绕)/u,
  },
  {
    field: 'statusMarkers',
    re: /(少爷|小姐|族长|长老|宗主|弟子|炼药师|斗者|斗师|大斗师|斗灵|斗王|斗皇|师父|老师|父亲|母亲|侍女|护卫)/u,
  },
];

const ITEM_FIELD_PATTERNS: Array<FieldPattern<ItemDescriptionField>> = [
  {
    field: 'material',
    re: /(木|青木|黑铁|精铁|玄铁|金属|铁|钢|玉|玉石|白玉|骨|兽骨|皮|绸|纸|竹|石|晶|打造|铸成|雕成|磨成)/u,
  },
  {
    field: 'colorShape',
    re: /(通体|颜色|青色|黑色|白色|金色|银色|赤红|血红|碧绿|细长|狭长|圆形|方形|巴掌大|三尺|剑身|刀身|边缘|纹路|花纹|形状|戒面|剑柄)/u,
  },
  {
    field: 'condition',
    re: /(古朴|破旧|残破|裂纹|磨损|泛黄|崭新|斑驳|暗淡|残缺|锋利|钝|锈迹|尘土|血迹)/u,
  },
  {
    field: 'usage',
    re: /(握着|持着|拿着|取出|递给|佩戴|戴着|挂在|藏在|收入|拔出|挥出|斩下|刺向|打开|展开|炼制|吞服|服下)/u,
  },
  {
    field: 'visualEffects',
    re: /(光芒|青芒|寒光|火光|火焰|雾气|黑雾|斗气|灵气|闪烁|流转|泛着|散发|绽放|缭绕|嗡鸣)/u,
  },
  {
    field: 'ownership',
    re: /(手中|指上|腰间|怀中|背后|身旁|萧炎的|纳兰嫣然的|药老的|递给|交给|属于|随身|贴身)/u,
  },
];

const LOCATION_FIELD_PATTERNS: Array<FieldPattern<LocationDescriptionField>> = [
  {
    field: 'environment',
    re: /(大厅|大殿|房间|屋内|院子|广场|山谷|山脉|密林|森林|城中|城门|街道|洞府|石室|山门|擂台|阁楼|楼阁|厅堂)/u,
  },
  {
    field: 'layout',
    re: /(中央|四周|两侧|门口|深处|角落|台阶|石桌|石台|墙壁|廊柱|高台|座位|摆着|立着|排列|坐满|围着)/u,
  },
  {
    field: 'atmosphere',
    re: /(安静|寂静|压抑|沉闷|紧张|肃穆|冷清|阴冷|喧闹|热闹|嘈杂|杀气|寒意|凝重|尴尬|沉默)/u,
  },
  {
    field: 'lighting',
    re: /(灯火|火光|月光|阳光|日光|烛光|昏暗|明亮|阴影|光线|黑暗|夜色|霞光|银辉|照亮|映照)/u,
  },
  {
    field: 'time',
    re: /(清晨|黄昏|傍晚|深夜|夜晚|夜里|夜色|白日|正午|黎明|此时|这时|片刻后)/u,
  },
  {
    field: 'actionContext',
    re: /(站在|坐在|聚集|围观|对峙|交锋|战斗|退婚|冲突|争执|议论|跪下|走入|冲进|离开|爆发|出手)/u,
  },
];

const CHARACTER_FIELD_ORDER: CharacterDescriptionField[] = [
  'appearance',
  'clothing',
  'body',
  'temperament',
  'signatureItems',
  'abilityVisuals',
  'statusMarkers',
];

const ITEM_FIELD_ORDER: ItemDescriptionField[] = [
  'material',
  'colorShape',
  'condition',
  'usage',
  'visualEffects',
  'ownership',
];

const LOCATION_FIELD_ORDER: LocationDescriptionField[] = [
  'environment',
  'layout',
  'atmosphere',
  'lighting',
  'time',
  'actionContext',
];

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。！？!?])|\n+/u)
    .map((part) => part.trim())
    .filter(Boolean);
}

function splitClauses(sentence: string): string[] {
  return sentence
    .split(/(?<=[，,；;、])/u)
    .map((part) => part.trim().replace(/^[“”"'‘’]+|[“”"'‘’]+$/gu, ''))
    .filter(Boolean);
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeName(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function matchedFields<Field extends string>(
  text: string,
  patterns: Array<FieldPattern<Field>>
): Field[] {
  return patterns
    .filter(({ re }) => re.test(text))
    .map(({ field }) => field);
}

function sentenceNames(sentence: string, names: string[]): string[] {
  return names.filter((name) => sentence.includes(name));
}

function usableAlias(alias: string, entityName: string, primaryNames: Set<string>): boolean {
  const value = alias.trim();
  if (value.length < 2 || GENERIC_ALIASES.has(value)) return false;
  const normalized = normalizeName(value);
  return normalized === normalizeName(entityName) || !primaryNames.has(normalized);
}

function entityNames(entity: EntityCandidate, primaryNames: Set<string>): string[] {
  return unique([
    entity.name,
    ...(entity.aliases || []).filter((alias) => usableAlias(alias, entity.name, primaryNames)),
  ]);
}

type ClauseOwner = 'target' | 'other' | 'unknown';

const OBSERVE_VERBS = '看向|望向|望着|盯着|瞧着|瞥向|扫向|打量|注视|凝视|看着|看清|看见|看到|看了|瞧见|望见';
const RECIPIENT_VERBS = '对着|朝着|冲着|向着|面向';
const GENERIC_PERSON_PATTERN = '少女|女孩|女子|女人|男子|青年|少年|老人|老者|美人|妇人|丫头|她|他|对方|此女|此人|那人';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function nameAlternation(names: string[]): string {
  return names.map(escapeRegExp).join('|');
}

function hasOrderedRelation(
  clause: string,
  subjects: string[],
  verbs: string,
  objects: string[]
): boolean {
  if (subjects.length === 0 || objects.length === 0) return false;
  return new RegExp(
    `(?:${nameAlternation(subjects)}).{0,18}(?:${verbs}).{0,18}(?:${nameAlternation(objects)})`,
    'u'
  ).test(clause);
}

function hasTargetObservingGeneric(clause: string, targetNames: string[]): boolean {
  if (targetNames.length === 0) return false;
  return new RegExp(
    `(?:${nameAlternation(targetNames)}).{0,18}(?:${OBSERVE_VERBS}).{0,18}(?:${GENERIC_PERSON_PATTERN})`,
    'u'
  ).test(clause);
}

function hasTargetRecipientFromPreviousOwner(clause: string, targetNames: string[]): boolean {
  if (targetNames.length === 0) return false;
  return new RegExp(
    `(?:${RECIPIENT_VERBS}).{0,8}(?:${nameAlternation(targetNames)})`,
    'u'
  ).test(clause);
}

function clauseOwner<Field extends string>(
  clause: string,
  evidence: DescriptionEvidenceSnippet<Field>,
  previousOwner: ClauseOwner
): ClauseOwner {
  const targetNames = sentenceNames(clause, evidence.matchedNames);
  const otherNames = sentenceNames(clause, evidence.otherMatchedNames || []);
  const hasTarget = targetNames.length > 0;
  const hasOther = otherNames.length > 0;

  if (hasTarget && hasOther) {
    if (hasOrderedRelation(clause, otherNames, OBSERVE_VERBS, targetNames)) return 'target';
    if (hasOrderedRelation(clause, targetNames, OBSERVE_VERBS, otherNames)) return 'other';
    return 'unknown';
  }

  if (hasOther) return 'other';

  if (hasTarget) {
    if (previousOwner === 'other' && hasTargetRecipientFromPreviousOwner(clause, targetNames)) {
      return 'other';
    }
    if (hasTargetObservingGeneric(clause, targetNames)) return 'other';
    return 'target';
  }

  return previousOwner;
}

function clauseBelongsToCurrentEntity(owner: ClauseOwner, evidence: DescriptionEvidenceSnippet<string>): boolean {
  return owner === 'target' || (owner === 'unknown' && (evidence.otherMatchedNames || []).length === 0);
}

function ownedFieldsInSentence<Field extends string>(
  sentence: string,
  matchedNames: string[],
  otherMatchedNames: string[],
  patterns: Array<FieldPattern<Field>>
): Field[] {
  const evidence: DescriptionEvidenceSnippet<Field> = {
    chapterIndex: 0,
    text: sentence,
    matchedNames,
    ...(otherMatchedNames.length > 0 ? { otherMatchedNames } : {}),
    fields: [],
  };
  const fields = new Set<Field>();
  let owner: ClauseOwner = 'unknown';

  for (const clause of splitClauses(sentence)) {
    owner = clauseOwner(clause, evidence, owner);
    if (!clauseBelongsToCurrentEntity(owner, evidence)) continue;
    for (const field of matchedFields(clause, patterns)) {
      fields.add(field);
    }
  }

  return [...fields];
}

function fieldSummary<Field extends string>(
  evidence: Array<DescriptionEvidenceSnippet<Field>>,
  field: Field,
  patterns: Array<FieldPattern<Field>>
): string {
  const snippets = evidence.flatMap((item) => {
    let owner: ClauseOwner = 'unknown';
    const result: string[] = [];
    for (const clause of splitClauses(item.text)) {
      owner = clauseOwner(clause, item, owner);
      if (!matchedFields(clause, patterns).includes(field)) continue;
      if (!clauseBelongsToCurrentEntity(owner, item)) continue;
      result.push(clause.replace(/[。！？!?，,；;、]+$/u, '').trim());
    }
    return result;
  });
  return unique(snippets).join('；');
}

function coverageFor<Field extends string>(
  filledFields: Field[],
  evidenceCount: number,
  strongFieldCount: number
): SourceCoverage {
  if (evidenceCount === 0) return 'none';
  return evidenceCount >= 2 && filledFields.length >= strongFieldCount ? 'strong' : 'partial';
}

function confidenceFor<Field extends string>(
  filledFields: Field[],
  evidenceCount: number,
  fieldOrder: Field[]
): number {
  if (evidenceCount === 0) return 0;
  const fieldScore = filledFields.length / fieldOrder.length;
  const evidenceScore = Math.min(evidenceCount / 4, 1);
  return Number(((fieldScore * 0.7) + (evidenceScore * 0.3)).toFixed(2));
}

function extractDescriptionPacks<EntityType extends string, Field extends string>(
  entityType: EntityType,
  entities: EntityCandidate[],
  chapters: DescriptionChapter[],
  fieldOrder: Field[],
  patterns: Array<FieldPattern<Field>>,
  strongFieldCount: number
): Array<EntityDescriptionPack<EntityType, Field>> {
  const primaryNames = new Set(entities.map((entity) => normalizeName(entity.name)));
  const allNames = unique(
    entities
      .flatMap((entity) => entityNames(entity, primaryNames))
      .filter((name) => name.length >= 2)
  );

  return entities.map((entity) => {
    const names = entityNames(entity, primaryNames);
    const targetNames = new Set(names.map(normalizeName));
    const otherNames = allNames.filter((name) => !targetNames.has(normalizeName(name)));
    const evidenceSnippets: Array<DescriptionEvidenceSnippet<Field>> = [];

    for (const chapter of chapters) {
      for (const sentence of splitSentences(chapter.content)) {
        const matchedNames = sentenceNames(sentence, names);
        if (matchedNames.length === 0) continue;
        const fields = matchedFields(sentence, patterns);
        if (fields.length === 0) continue;
        const otherMatchedNames = sentenceNames(sentence, otherNames);
        const ownedFields = ownedFieldsInSentence(sentence, matchedNames, otherMatchedNames, patterns);
        if (ownedFields.length === 0) continue;
        evidenceSnippets.push({
          chapterIndex: chapter.index,
          chapterTitle: chapter.title,
          text: sentence,
          matchedNames,
          ...(otherMatchedNames.length > 0 ? { otherMatchedNames } : {}),
          fields: ownedFields,
        });
      }
    }

    const fields = Object.fromEntries(
      fieldOrder.map((field) => [field, fieldSummary(evidenceSnippets, field, patterns)])
    ) as Record<Field, string>;
    const filledFields = fieldOrder.filter((field) => fields[field]);
    const missingFields = fieldOrder.filter((field) => !fields[field]);
    const sourceCoverage = coverageFor(filledFields, evidenceSnippets.length, strongFieldCount);

    return {
      entityType,
      name: entity.name,
      aliases: names.filter((name) => normalizeName(name) !== normalizeName(entity.name)),
      sourceDescription: filledFields.map((field) => fields[field]).join('；'),
      fields,
      missingFields,
      evidenceSnippets,
      sourceCoverage,
      confidence: confidenceFor(filledFields, evidenceSnippets.length, fieldOrder),
      needsReview: sourceCoverage !== 'strong',
    };
  });
}

export function extractCharacterDescriptionPacks(
  characters: CharacterCandidate[],
  chapters: DescriptionChapter[]
): CharacterDescriptionPack[] {
  return extractDescriptionPacks(
    'character',
    characters,
    chapters,
    CHARACTER_FIELD_ORDER,
    CHARACTER_FIELD_PATTERNS,
    4
  );
}

export function extractItemDescriptionPacks(
  items: ItemCandidate[],
  chapters: DescriptionChapter[]
): ItemDescriptionPack[] {
  return extractDescriptionPacks(
    'item',
    items,
    chapters,
    ITEM_FIELD_ORDER,
    ITEM_FIELD_PATTERNS,
    3
  );
}

export function extractLocationDescriptionPacks(
  locations: LocationCandidate[],
  chapters: DescriptionChapter[]
): LocationDescriptionPack[] {
  return extractDescriptionPacks(
    'location',
    locations,
    chapters,
    LOCATION_FIELD_ORDER,
    LOCATION_FIELD_PATTERNS,
    3
  );
}
