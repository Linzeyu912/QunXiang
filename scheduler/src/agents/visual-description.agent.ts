import type { AgentType, Character, Item, Location } from '@novel-agent/core';
import { getDefaultProvider } from '@novel-agent/llm';
import { z } from 'zod';
import type {
  CharacterDescriptionField,
  CharacterDescriptionPack,
  DescriptionEvidenceSnippet,
  EntityDescriptionPack,
  ItemDescriptionField,
  ItemDescriptionPack,
  LocationDescriptionField,
  LocationDescriptionPack,
  SourceCoverage,
} from './entity-descriptions.js';

export const visualDescriptionAgentType: AgentType = 'visual-description';

export type VisualCompletionStatus = 'source_only' | 'llm_completed' | 'llm_inferred';
export type VisualDescriptionSource = 'source' | 'llm' | 'mixed';

export interface EnhancedEntityDescriptionPack<EntityType extends string, Field extends string>
  extends EntityDescriptionPack<EntityType, Field> {
  visualFields: Record<Field, string>;
  visualDetails: Record<string, string>;
  inferredFields: Field[];
  summarizedFields: Field[];
  enhancedDescription: string;
  finalDescription: string;
  llmSupplement: string;
  supplementDescription: string;
  completionStatus: VisualCompletionStatus;
  descriptionSource: VisualDescriptionSource;
}

export type CharacterVisualDescriptionPack = EnhancedEntityDescriptionPack<'character', CharacterDescriptionField>;
export type ItemVisualDescriptionPack = EnhancedEntityDescriptionPack<'item', ItemDescriptionField>;
export type LocationVisualDescriptionPack = EnhancedEntityDescriptionPack<'location', LocationDescriptionField>;

type CharacterEntity = Omit<Character, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>;
type ItemEntity = Omit<Item, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>;
type LocationEntity = Omit<Location, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>;
type EntityKind = 'characters' | 'items' | 'locations';

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

type EntityCandidate = {
  name: string;
  aliases?: string[];
  description?: string;
  confidence?: number;
  mentionCount?: number;
  tier?: string;
  importanceScore?: number;
  storyScore?: number;
  productionScore?: number;
};

type AnyEnhancedPack =
  | CharacterVisualDescriptionPack
  | ItemVisualDescriptionPack
  | LocationVisualDescriptionPack;

export interface VisualDescriptionPayload extends Record<string, unknown> {
  characters: CharacterEntity[];
  locations?: LocationEntity[];
  items?: ItemEntity[];
  characterDescriptions?: CharacterDescriptionPack[];
  itemDescriptions?: ItemDescriptionPack[];
  locationDescriptions?: LocationDescriptionPack[];
}

export interface VisualDescriptionResult extends VisualDescriptionPayload {
  characters: CharacterEntity[];
  locations: LocationEntity[];
  items: ItemEntity[];
  characterVisualDescriptions: CharacterVisualDescriptionPack[];
  itemVisualDescriptions: ItemVisualDescriptionPack[];
  locationVisualDescriptions: LocationVisualDescriptionPack[];
  visualDescription: {
    requested: number;
    completed: number;
    sourceOnly: number;
    inferred: number;
  };
}

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

const completionEntitySchema = z.object({
  name: z.string(),
  visualFields: z.record(z.string()).optional().default({}),
  visualDetails: z.record(z.string()).optional().default({}),
  enhancedDescription: z.string().optional().default(''),
  llmSupplement: z.string().optional().default(''),
});

const completionSchema = z.object({
  characters: z.array(completionEntitySchema).optional().default([]),
  items: z.array(completionEntitySchema).optional().default([]),
  locations: z.array(completionEntitySchema).optional().default([]),
});

interface CompletionEntity {
  name: string;
  visualFields?: Record<string, string>;
  visualDetails?: Record<string, string>;
  enhancedDescription?: string;
  llmSupplement?: string;
}

const SOURCE_FIELD_SUMMARY_CHARS = Number(process.env.VISUAL_DESCRIPTION_SOURCE_FIELD_SUMMARY_CHARS || 160);
const SOURCE_DESCRIPTION_SUMMARY_CHARS = Number(process.env.VISUAL_DESCRIPTION_SOURCE_DESCRIPTION_SUMMARY_CHARS || 900);
const PROMPT_SOURCE_FIELD_CHARS_MAJOR = Number(process.env.VISUAL_DESCRIPTION_PROMPT_SOURCE_FIELD_CHARS_MAJOR || 1000);
const PROMPT_SOURCE_FIELD_CHARS_SECONDARY = Number(process.env.VISUAL_DESCRIPTION_PROMPT_SOURCE_FIELD_CHARS_SECONDARY || 520);
const PROMPT_SOURCE_FIELD_PARTS_MAJOR = Number(process.env.VISUAL_DESCRIPTION_PROMPT_SOURCE_FIELD_PARTS_MAJOR || 16);
const PROMPT_SOURCE_FIELD_PARTS_SECONDARY = Number(process.env.VISUAL_DESCRIPTION_PROMPT_SOURCE_FIELD_PARTS_SECONDARY || 8);
const PROMPT_SOURCE_DESCRIPTION_CHARS_MAJOR = Number(process.env.VISUAL_DESCRIPTION_PROMPT_SOURCE_DESCRIPTION_CHARS_MAJOR || 1400);
const PROMPT_SOURCE_DESCRIPTION_CHARS_SECONDARY = Number(process.env.VISUAL_DESCRIPTION_PROMPT_SOURCE_DESCRIPTION_CHARS_SECONDARY || 700);
const LOCAL_SOURCE_FIELD_PARTS = Number(process.env.VISUAL_DESCRIPTION_LOCAL_SOURCE_FIELD_PARTS || 6);
const SOURCE_FIELD_SUMMARY_PARTS = Number(process.env.VISUAL_DESCRIPTION_SOURCE_FIELD_SUMMARY_PARTS || 4);
const FALLBACK_ENTITY_DESCRIPTION_CHARS = Number(process.env.VISUAL_DESCRIPTION_FALLBACK_ENTITY_DESCRIPTION_CHARS || 520);
const FALLBACK_ENTITY_DESCRIPTION_PARTS = Number(process.env.VISUAL_DESCRIPTION_FALLBACK_ENTITY_DESCRIPTION_PARTS || 4);
const SUPPLEMENT_SECONDARY = ['1', 'true', 'yes'].includes(
  String(process.env.VISUAL_DESCRIPTION_SUPPLEMENT_SECONDARY || '').toLocaleLowerCase()
);
// Max concurrent LLM calls during visual-description completion (mirrors
// EXTRACTOR_MAX_CONCURRENT_BATCHES). Groups are independent, so raising this
// cuts wall-clock without changing results — only limited by API rate limits.
const MAX_CONCURRENT_GROUPS = Math.max(1, Number(process.env.VISUAL_DESCRIPTION_MAX_CONCURRENT || 4));

const VISUAL_DESCRIPTION_SYSTEM_PROMPT = `你是小说实体视觉描述补全 agent。
任务：根据已提取的原文证据，为人物、道具、场景生成可用于后续生图提示词的视觉描述资料。

必须遵守：
- 所有 visualFields、visualDetails、enhancedDescription、llmSupplement 的内容必须使用简体中文；不要输出英文描述。
- sourceFields/fields 和 evidenceSnippets 是原文证据，只能依据输入保留，不要改写或覆盖。
- 【关键】visualFields 每个字段的内容必须是**纯视觉描述语言**：直接描述外貌/材质/颜色/尺寸/光线等可见属性。严禁写入动作叙述（"望着""走出""转过身"）、心理活动（"心想""感到"）、对话引用、世界观设定（"斗气大陆""玄阶功法"）、实力等级对比、战斗力强弱。如果 sourceFields 混入了叙述碎片，只提取其中纯视觉的部分，丢弃其余。
- 只有原文缺失的字段，才可以根据简介、人物性格、身份、剧情气质做保守补写。
- 不要把补写内容说成原文描写；补写只放在缺失字段里，并写入 llmSupplement。
- 如果只是概括已有 sourceFields，没有补写缺失字段，llmSupplement 必须留空。
- enhancedDescription 和 llmSupplement 都只写实体视觉描述本身，不要写”原文未描写””enhancedDescription 中”等过程说明。
- 如果原文没有具体外貌/材质/场景描写，允许做克制补全，但不要创造具体到不合理的颜色、服饰纹样、五官细节、材质品牌等硬设定。

【人物 enhancedDescription 必须包含的叙事视觉描述】
主角或核心人物必须写成一段流畅的自然中文叙事，将以下所有可视特征无缝织入：
身材体型、脸型轮廓、整体气质、头发（颜色/长度/样式）、眼睛（颜色/形状/神态）、鼻子、嘴唇、皮肤（肤色/质感）、装束穿着、标志性道具、能力视觉特效（如有）。
——写法示例：”少年身材修长挺拔，一张清秀的瓜子脸上嵌着深邃如夜空的黑瞳，高挺的鼻梁下薄唇紧抿，透着与年龄不符的坚毅。乌黑长发随意束在脑后，几缕碎发垂落额前。身着青色劲装，袖口绣有暗纹，左手无名指上戴着一枚古朴的黑色戒指，戒面隐隐泛着幽光。”
次要人物可简略，但至少包含身材、脸型、气质、装束的关键信息。

【道具 enhancedDescription 必须包含的叙事视觉描述】
物品/道具必须写成一段流畅的自然中文叙事，织入：
材质质感、颜色与形状、尺寸大小、状态（新旧/完整/破损）、使用方式、视觉光效（如有）、归属者。
——写法示例：”通体碧绿的丹药约龙眼大小，表面光滑温润，隐隐散发着一层淡绿色的光泽，异香从中弥漫而出，光是闻一闻便让人精神为之一振。丹药装在古色古香的玉匣之中，玉匣边缘镶有一圈金线。”

【地点 enhancedDescription 必须包含的叙事视觉描述】
地点必须写成一段流畅的自然中文叙事，织入：
整体环境、空间布局与尺度、氛围基调、光线特征、时间感、该地点发生的关键行动、标志性视觉锚点。
——写法示例：”萧家大厅宽敞肃穆，青砖铺地，四壁悬挂家族旗帜与古字画。正上方设主座与三位长老席位，中央可容数十人聚集。厅中光线从雕花窗棂透入，在青砖上映出斑驳光影。角落处萧薰儿常捧书静坐，气氛平日庄重，退婚当日却剑拔弩张，少女冷语如惊雷般在大厅中回荡。”

- 不要生成生图 prompt，不要出现镜头、画幅、风格、模型参数。

只返回 JSON：
{
  “characters”: [{“name”: “entity name”, “visualFields”: {“field”: “value”}, “visualDetails”: {“bodyBuild”: “...”, “faceShape”: “...”, “temperament”: “...”, “hair”: “...”, “eyes”: “...”, “nose”: “...”, “lips”: “...”, “skin”: “...”, “makeupStyling”: “...”}, “enhancedDescription”: “...”, “llmSupplement”: “...”}],
  “items”: [{“name”: “entity name”, “visualFields”: {“field”: “value”}, “visualDetails”: {“materialTexture”: “...”, “colorShape”: “...”, “condition”: “...”, “scale”: “...”, “effects”: “...”}, “enhancedDescription”: “...”, “llmSupplement”: “...”}],
  “locations”: [{“name”: “entity name”, “visualFields”: {“field”: “value”}, “visualDetails”: {“environment”: “...”, “layout”: “...”, “atmosphere”: “...”, “lighting”: “...”, “keyVisualAnchors”: “...”}, “enhancedDescription”: “...”, “llmSupplement”: “...”}]
}`;

interface CompletionInput<EntityType extends string, Field extends string> {
  kind: EntityKind;
  entityType: EntityType;
  name: string;
  aliases: string[];
  currentDescription: string;
  priorityHint: 'major' | 'secondary';
  sourcePack: EntityDescriptionPack<EntityType, Field>;
  fieldOrder: Field[];
}

type AnyCompletionInput = CompletionInput<string, any>;

function cleanText(value: string | null | undefined): string {
  return (value || '').trim().replace(/\s+/gu, ' ');
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(cleanText).filter(Boolean))];
}

function splitDescriptionParts(value: string | null | undefined): string[] {
  return unique(cleanText(value).split(/[;；。\n]+/u));
}

function sanitizeSupplementPart(value: string): string {
  const text = cleanText(value);
  const quoted = text.match(/['"“‘]([^'"”’]{2,120})['"”’]/u);
  if (quoted && /(?:原文|证据|字段|补写|保守|移入|归入|appearance|clothing|body|temperament|signatureItems|abilityVisuals|statusMarkers)/iu.test(text)) {
    return cleanText(quoted[1]);
  }

  return text
    .replace(/^(?:appearance|clothing|body|temperament|signatureItems|abilityVisuals|statusMarkers)\s*[：:]\s*/iu, '')
    .replace(/（[^）]*(?:原文|依据|字段|evidenceSnippets|appearance|clothing|body|temperament|signatureItems|abilityVisuals|statusMarkers)[^）]*）/giu, '')
    .replace(/^原文(?:未描写|没有)[^，,。；;]*[，,]\s*/u, '')
    .replace(/^依据[^，,。；;]*[，,]\s*/u, '')
    .replace(/^作为/u, '')
    .replace(/^保守描述为/u, '')
    .replace(/来自evidenceSnippets补充/giu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function cleanLlmSupplement(value: string | null | undefined): string {
  return unique(splitDescriptionParts(value).map(sanitizeSupplementPart)).join('；');
}

function cleanVisualDetails(value: Record<string, string> | undefined): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value || {})
      .map(([key, detail]) => [key, cleanText(detail)])
      .filter(([, detail]) => Boolean(detail))
  );
}

function shouldSummarizeSourceField(value: string): boolean {
  return value.length > SOURCE_FIELD_SUMMARY_CHARS || splitDescriptionParts(value).length > SOURCE_FIELD_SUMMARY_PARTS;
}

function sampleDescriptionForPrompt(
  value: string | null | undefined,
  maxChars: number,
  maxParts: number
): { text: string; omittedParts: number } {
  const parts = splitDescriptionParts(value);
  const kept: string[] = [];
  let chars = 0;

  for (const part of parts) {
    const nextChars = chars + part.length + (kept.length > 0 ? 2 : 0);
    if (kept.length >= maxParts || (kept.length > 0 && nextChars > maxChars)) break;
    kept.push(part);
    chars = nextChars;
  }

  return {
    text: kept.join('; '),
    omittedParts: Math.max(parts.length - kept.length, 0),
  };
}

function normalizeName(value: string): string {
  return cleanText(value).toLocaleLowerCase();
}

function usableAlias(alias: string, entityName: string, blockedPrimaryNames: Set<string> = new Set()): boolean {
  const value = cleanText(alias);
  if (value.length < 2 || GENERIC_ALIASES.has(value)) return false;
  const normalized = normalizeName(value);
  return normalized === normalizeName(entityName) || !blockedPrimaryNames.has(normalized);
}

function entityNames(entity: { name: string; aliases?: string[] }): string[] {
  return unique([
    entity.name,
    ...(entity.aliases || []).filter((alias) => usableAlias(alias, entity.name)),
  ]);
}

function hasNameOverlap(
  entity: { name: string; aliases?: string[] },
  pack: { name: string; aliases?: string[] }
): boolean {
  const names = new Set(entityNames(entity).map(normalizeName));
  return entityNames(pack).some((name) => names.has(normalizeName(name)));
}

function emptyFields<Field extends string>(fieldOrder: Field[]): Record<Field, string> {
  return Object.fromEntries(fieldOrder.map((field) => [field, ''])) as Record<Field, string>;
}

function sourceCoverageRank(value: SourceCoverage): number {
  if (value === 'strong') return 2;
  if (value === 'partial') return 1;
  return 0;
}

function bestSourceCoverage(values: SourceCoverage[]): SourceCoverage {
  if (values.some((value) => value === 'strong')) return 'strong';
  if (values.some((value) => value === 'partial')) return 'partial';
  return 'none';
}

function evidenceKey<Field extends string>(evidence: DescriptionEvidenceSnippet<Field>): string {
  return [
    evidence.chapterIndex,
    evidence.chapterTitle || '',
    evidence.text,
    evidence.matchedNames.join('|'),
    evidence.fields.join('|'),
  ].join('::');
}

function mergeEvidence<Field extends string>(
  packs: Array<EntityDescriptionPack<string, Field>>
): Array<DescriptionEvidenceSnippet<Field>> {
  const seen = new Set<string>();
  const result: Array<DescriptionEvidenceSnippet<Field>> = [];
  for (const evidence of packs.flatMap((pack) => pack.evidenceSnippets)) {
    const key = evidenceKey(evidence);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(evidence);
  }
  return result;
}

function buildSourceDescription<Field extends string>(
  fieldOrder: Field[],
  packs: Array<EntityDescriptionPack<string, Field>>,
  fields: Record<Field, string>
): string {
  return unique([
    ...packs.flatMap((pack) => splitDescriptionParts(pack.sourceDescription)),
    ...fieldOrder.map((field) => fields[field]),
  ]).join('; ');
}

function mergeSourcePacks<EntityType extends string, Field extends string>(
  entityType: EntityType,
  entity: EntityCandidate,
  packs: Array<EntityDescriptionPack<EntityType, Field>>,
  fieldOrder: Field[],
  blockedPrimaryNames: Set<string>
): EntityDescriptionPack<EntityType, Field> {
  const safeEntity = {
    ...entity,
    aliases: (entity.aliases || []).filter((alias) => usableAlias(alias, entity.name, blockedPrimaryNames)),
  };
  const matchedPacks = packs.filter((pack) => hasNameOverlap(safeEntity, pack));
  const fields = emptyFields(fieldOrder);

  for (const field of fieldOrder) {
    fields[field] = unique(matchedPacks.map((pack) => pack.fields[field] || '')).join('; ');
  }

  const aliases = unique([
    ...(safeEntity.aliases || []),
    ...matchedPacks.flatMap((pack) => [
      pack.name,
      ...(pack.aliases || []).filter((alias) => usableAlias(alias, entity.name, blockedPrimaryNames)),
    ]),
  ]).filter((alias) => normalizeName(alias) !== normalizeName(entity.name));
  const missingFields = fieldOrder.filter((field) => !fields[field]);
  const sourceCoverage = bestSourceCoverage(matchedPacks.map((pack) => pack.sourceCoverage));
  const confidence = matchedPacks.length > 0
    ? Math.max(...matchedPacks.map((pack) => pack.confidence))
    : 0;

  return {
    entityType,
    name: entity.name,
    aliases,
    sourceDescription: buildSourceDescription(fieldOrder, matchedPacks, fields),
    fields,
    missingFields,
    evidenceSnippets: mergeEvidence(matchedPacks),
    sourceCoverage,
    confidence,
    needsReview: sourceCoverage !== 'strong',
    tier: (entity as any).tier,
    importanceScore: (entity as any).importanceScore,
  };
}

function isMajorEntity(kind: EntityKind, entity: EntityCandidate): boolean {
  const mentionCount = entity.mentionCount ?? 0;
  const importanceScore = entity.importanceScore ?? 0;
  const storyScore = entity.storyScore ?? 0;

  if (entity.tier === 'core' || entity.tier === 'supporting') return true;
  if (kind === 'characters') {
    return mentionCount >= 20;
  }
  if (kind === 'items') {
    return mentionCount >= 5 || importanceScore >= 0.38 || storyScore >= 3;
  }
  return mentionCount >= 5 || importanceScore >= 0.34 || storyScore >= 2;
}

function collectCompletionInputs<EntityType extends string, Field extends string>(
  kind: EntityKind,
  entityType: EntityType,
  entities: EntityCandidate[],
  packs: Array<EntityDescriptionPack<EntityType, Field>>,
  fieldOrder: Field[]
): Array<CompletionInput<EntityType, Field>> {
  const blockedPrimaryNamesByEntity = new Map<string, Set<string>>();
  for (const entity of entities) {
    blockedPrimaryNamesByEntity.set(
      normalizeName(entity.name),
      new Set(
        entities
          .map((candidate) => normalizeName(candidate.name))
          .filter((name) => name !== normalizeName(entity.name))
      )
    );
  }

  return entities.map((entity) => {
    const sourcePack = mergeSourcePacks(
      entityType,
      entity,
      packs,
      fieldOrder,
      blockedPrimaryNamesByEntity.get(normalizeName(entity.name)) || new Set()
    );
    return {
      kind,
      entityType,
      name: entity.name,
      aliases: sourcePack.aliases,
      currentDescription: cleanText(entity.description),
      priorityHint: isMajorEntity(kind, entity) ? 'major' : 'secondary',
      sourcePack,
      fieldOrder,
    };
  });
}

function needsLlmCompletion(input: AnyCompletionInput): boolean {
  // source 字段过长需要概括时，无论主次实体都触发 LLM 做概括
  if (needsSourceSummary(input)) return true;
  // Major entities always get LLM completion — they need visualDetails for prompt generation
  if (input.priorityHint === 'major') return true;
  // Secondary entities: 默认不补全缺失的视觉字段（次要实体不值得为它消耗 LLM 调用），
  // 只有显式开启 VISUAL_DESCRIPTION_SUPPLEMENT_SECONDARY 时才补全。
  // （旧逻辑 "return missingFields.length > 0" 会让任何缺字段的次要实体都触发 LLM，
  // 与「默认不推断次要实体」的设计意图相悖。）
  return SUPPLEMENT_SECONDARY;
}

function needsSourceSummary(input: AnyCompletionInput): boolean {
  return input.sourcePack.sourceDescription.length > SOURCE_DESCRIPTION_SUMMARY_CHARS
    || input.fieldOrder.some((field: string) => (input.sourcePack.fields[field] || '').length > SOURCE_FIELD_SUMMARY_CHARS);
}

function promptLimits(input: AnyCompletionInput): { fieldChars: number; fieldParts: number; descriptionChars: number } {
  if (input.priorityHint === 'major') {
    return {
      fieldChars: PROMPT_SOURCE_FIELD_CHARS_MAJOR,
      fieldParts: PROMPT_SOURCE_FIELD_PARTS_MAJOR,
      descriptionChars: PROMPT_SOURCE_DESCRIPTION_CHARS_MAJOR,
    };
  }
  return {
    fieldChars: PROMPT_SOURCE_FIELD_CHARS_SECONDARY,
    fieldParts: PROMPT_SOURCE_FIELD_PARTS_SECONDARY,
    descriptionChars: PROMPT_SOURCE_DESCRIPTION_CHARS_SECONDARY,
  };
}

function sampleFieldsForPrompt<Field extends string>(
  input: CompletionInput<string, Field>,
  maxChars: number,
  maxParts: number
): { sourceFields: Record<Field, string>; sourceFieldOmittedParts: Record<Field, number> } {
  const sourceFields = emptyFields(input.fieldOrder);
  const sourceFieldOmittedParts = Object.fromEntries(
    input.fieldOrder.map((field) => [field, 0])
  ) as Record<Field, number>;

  for (const field of input.fieldOrder) {
    const sample = sampleDescriptionForPrompt(input.sourcePack.fields[field], maxChars, maxParts);
    sourceFields[field] = sample.text;
    sourceFieldOmittedParts[field] = sample.omittedParts;
  }

  return { sourceFields, sourceFieldOmittedParts };
}

function groupInputs(inputs: AnyCompletionInput[]): AnyCompletionInput[][] {
  const maxChars = Number(process.env.VISUAL_DESCRIPTION_MAX_CHARS || 22000);
  // Hard cap on entities per call — the PRIMARY quality lever. Smaller groups
  // keep per-entity attention high and avoid output truncation / field mixing,
  // which the char budget alone can't prevent for small-payload entities
  // (配角/物品/地点 体积小，纯字符预算会把它们塞到 15+ 一组).
  const maxEntities = Math.max(1, Number(process.env.VISUAL_DESCRIPTION_MAX_ENTITIES_PER_GROUP || 6));
  const groups: AnyCompletionInput[][] = [];
  let current: AnyCompletionInput[] = [];
  let currentChars = 0;

  for (const input of inputs) {
    const estimated = JSON.stringify(promptEntity(input)).length + 160;
    if (current.length > 0 && (currentChars + estimated > maxChars || current.length >= maxEntities)) {
      groups.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(input);
    currentChars += estimated;
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

function visualDetailTargets(input: AnyCompletionInput): string[] {
  if (input.kind === 'characters') {
    if (input.priorityHint === 'major') {
      return [
        '主角或核心人物：尽量补够人物特征，包括身材、脸型、整体气质、头发、眼睛、鼻子、嘴唇、皮肤、妆造/装束',
        'visualDetails 建议键：bodyBuild, faceShape, temperament, hair, eyes, nose, lips, skin, makeupStyling',
        '若原文没有具体五官，不要硬造夸张特征；按年龄、身份、气质做保守可视化补写',
      ];
    }
    return [
      '配角：补足辨识所需的外观、服饰、身材或气质即可，不必写满头发、眼睛、鼻子、嘴唇、皮肤、妆造',
      'visualDetails 可按需要返回 bodyBuild, faceShape, temperament, hair, eyes, skin, makeupStyling',
    ];
  }
  if (input.kind === 'items') {
    return [
      '道具：尽可能补完整材质/质感、颜色形状、尺寸、状态、使用方式、光效、归属',
      'visualDetails 建议键：materialTexture, colorShape, condition, scale, usage, effects, ownership',
    ];
  }
  return [
    '地点：尽可能补完整环境、空间布局、氛围、光线、时间感、行动语境、关键视觉锚点',
    'visualDetails 建议键：environment, layout, atmosphere, lighting, time, actionContext, keyVisualAnchors',
  ];
}

function promptEntity<Field extends string>(input: CompletionInput<string, Field>) {
  const limits = promptLimits(input);
  const sourceDescription = sampleDescriptionForPrompt(
    input.sourcePack.sourceDescription,
    limits.descriptionChars,
    limits.fieldParts
  );
  const { sourceFields, sourceFieldOmittedParts } = sampleFieldsForPrompt(
    input,
    limits.fieldChars,
    limits.fieldParts
  );

  return {
    name: input.name,
    aliases: input.aliases,
    priorityHint: input.priorityHint,
    currentDescription: input.currentDescription,
    sourceDescription: sourceDescription.text,
    sourceDescriptionOmittedParts: sourceDescription.omittedParts,
    sourceFields,
    sourceFieldOmittedParts,
    missingFields: input.sourcePack.missingFields,
    visualDetailTargets: visualDetailTargets(input),
    sourceCoverage: input.sourcePack.sourceCoverage,
    evidenceSnippets: input.sourcePack.evidenceSnippets.slice(0, 6).map((evidence) => ({
      chapterIndex: evidence.chapterIndex,
      text: evidence.text,
      fields: evidence.fields,
    })),
  };
}

function buildUserPrompt(inputs: AnyCompletionInput[]): string {
  const payload = {
    characters: inputs.filter((input) => input.kind === 'characters').map(promptEntity),
    items: inputs.filter((input) => input.kind === 'items').map(promptEntity),
    locations: inputs.filter((input) => input.kind === 'locations').map(promptEntity),
  };

  return `请补全并清洗以下实体的视觉描述字段。

【关键指令】
1. 已有 sourceFields 中常混入动作叙述、对话引用、世界观设定等非视觉碎片。你必须为每个字段（无论是否 missing）输出清洗后的**纯视觉描述**写入 visualFields。过滤规则：丢弃"望着""走出""说道""斗气大陆""玄阶功法"等非视觉内容，只保留外貌/材质/色彩/形状/尺寸/光线/质感等可视属性。
2. missingFields 按现有规则保守补写。
3. sourceFieldOmittedParts 只表示还有未放入 prompt 的同类证据，不需要处理。

【强制要求 — enhancedDescription 质量】
enhancedDescription 必须是一段能独立使用的流畅中文叙事，将所有 visualFields 和 visualDetails 的信息无缝织入一个自然段落...\n\n${JSON.stringify(payload, null, 2)}`;
}

function outputKey(kind: EntityKind, name: string): string {
  return `${kind}:${normalizeName(name)}`;
}

function completionMap(result: {
  characters?: CompletionEntity[];
  items?: CompletionEntity[];
  locations?: CompletionEntity[];
}): Map<string, CompletionEntity> {
  const map = new Map<string, CompletionEntity>();
  for (const entity of result.characters ?? []) {
    map.set(outputKey('characters', entity.name), entity);
  }
  for (const entity of result.items ?? []) {
    map.set(outputKey('items', entity.name), entity);
  }
  for (const entity of result.locations ?? []) {
    map.set(outputKey('locations', entity.name), entity);
  }
  return map;
}

function safeLlmFields<Field extends string>(
  sourcePack: EntityDescriptionPack<string, Field>,
  fieldOrder: Field[],
  llm: CompletionEntity | undefined
): { visualFields: Record<Field, string>; inferredFields: Field[]; summarizedFields: Field[] } {
  const visualFields = { ...sourcePack.fields };
  const inferredFields: Field[] = [];
  const summarizedFields: Field[] = [];

  for (const field of fieldOrder) {
    const llmValue = cleanText(llm?.visualFields?.[field] || '');
    if (sourcePack.fields[field]) {
      const sourceValue = sourcePack.fields[field];
      // source 有值时：只有当 source 字段过长需要概括、且 LLM 返回了概括值，
      // 才采用 LLM 的概括（标 summarized）。否则保留 source 原值——
      // LLM 不应覆盖原文已有的、清晰准确的短描述（如把"黑袍"改成"白袍"是错误）。
      if (llmValue && shouldSummarizeSourceField(sourceValue)) {
        visualFields[field] = llmValue;
        summarizedFields.push(field);
      } else if (shouldSummarizeSourceField(sourceValue)) {
        // source 过长但 LLM 没返回概括：本地截断
        visualFields[field] = sampleDescriptionForPrompt(
          sourceValue,
          SOURCE_FIELD_SUMMARY_CHARS,
          LOCAL_SOURCE_FIELD_PARTS
        ).text || sourceValue.slice(0, SOURCE_FIELD_SUMMARY_CHARS);
      } else {
        visualFields[field] = sourceValue;
      }
      continue;
    }
    if (!llmValue) continue;
    visualFields[field] = llmValue;
    inferredFields.push(field);
  }

  return { visualFields, inferredFields, summarizedFields };
}

function includesText(text: string, part: string): boolean {
  const cleanPart = cleanText(part);
  if (cleanPart.length < 4) return false;
  return cleanText(text)?.toLocaleLowerCase().includes(cleanPart.toLocaleLowerCase()) ?? false;
}

function hasProtectedFieldConflict<Field extends string>(
  sourcePack: EntityDescriptionPack<string, Field>,
  fieldOrder: Field[],
  summarizedFields: Field[],
  llm: CompletionEntity | undefined,
  enhancedDescription: string
): boolean {
  const summarized = new Set<Field>(summarizedFields);
  for (const field of fieldOrder) {
    if (summarized.has(field)) continue;

    const sourceValue = cleanText(sourcePack.fields[field]);
    const llmValue = cleanText(llm?.visualFields?.[field]);
    if (!sourceValue || !llmValue || sourceValue === llmValue) continue;
    if (includesText(enhancedDescription, llmValue)) return true;
  }

  return false;
}

function composeEnhancedDescription<Field extends string>(
  input: CompletionInput<string, Field>,
  sourcePack: EntityDescriptionPack<string, Field>,
  fieldOrder: Field[],
  visualFields: Record<Field, string>,
  inferredFields: Field[],
  summarizedFields: Field[],
  llm: CompletionEntity | undefined
): string {
  const hasLlmFieldMap = Object.values(llm?.visualFields || {}).some((value) => cleanText(value));
  const visualDetailParts = Object.values(cleanVisualDetails(llm?.visualDetails));
  const llmEnhancedDescription = cleanText(llm?.enhancedDescription);
  const hasLlmCompletion = Boolean(llmEnhancedDescription || llm?.llmSupplement || hasLlmFieldMap || visualDetailParts.length > 0);
  if (!hasLlmCompletion && input.currentDescription) {
    const fallback = sampleDescriptionForPrompt(
      input.currentDescription,
      FALLBACK_ENTITY_DESCRIPTION_CHARS,
      FALLBACK_ENTITY_DESCRIPTION_PARTS
    ).text;
    return fallback || input.currentDescription.slice(0, FALLBACK_ENTITY_DESCRIPTION_CHARS);
  }
  if (llmEnhancedDescription && !hasProtectedFieldConflict(sourcePack, fieldOrder, summarizedFields, llm, llmEnhancedDescription)) {
    return llmEnhancedDescription;
  }

  // Fallback: build narrative from visualFields + visualDetails instead of just
  // semicolon-joining. Each entity kind has a natural joining pattern.
  const fieldParts = fieldOrder.map((field) => visualFields[field]).filter(Boolean);
  const supplementParts = inferredFields.length > 0 ? splitDescriptionParts(cleanLlmSupplement(llm?.llmSupplement)) : [];
  const details = visualDetailParts.filter(Boolean);

  if (input.kind === 'characters') {
    const clauses: string[] = [];
    const appearance = visualFields['appearance' as Field] as string | undefined;
    const clothing = visualFields['clothing' as Field] as string | undefined;
    const body = visualFields['body' as Field] as string | undefined;
    const temperament = visualFields['temperament' as Field] as string | undefined;
    const ability = visualFields['abilityVisuals' as Field] as string | undefined;
    const items = visualFields['signatureItems' as Field] as string | undefined;
    if (body) clauses.push(body);
    if (appearance) clauses.push(appearance);
    if (temperament) clauses.push(temperament);
    if (clothing) clauses.push(clothing);
    clauses.push(...details.filter(d => !clauses.some(c => c.includes(d))));
    if (items) clauses.push(`标志性物品：${items}`);
    if (ability) clauses.push(`能力特效：${ability}`);
    const all = [...clauses, ...supplementParts.filter(s => !clauses.some(c => c.includes(s)))];
    if (all.length > 0) return all.map(s => s.replace(/[；;]$/, '').trim()).filter(Boolean).join('。') + '。';
  }

  if (input.kind === 'items') {
    const clauses: string[] = [];
    const material = visualFields['material' as Field] as string | undefined;
    const colorShape = visualFields['colorShape' as Field] as string | undefined;
    const condition = visualFields['condition' as Field] as string | undefined;
    const usage = visualFields['usage' as Field] as string | undefined;
    const effects = visualFields['visualEffects' as Field] as string | undefined;
    const ownership = visualFields['ownership' as Field] as string | undefined;
    if (material) clauses.push(material);
    if (colorShape) clauses.push(colorShape);
    if (condition) clauses.push(condition);
    clauses.push(...details.filter(d => !clauses.some(c => c.includes(d))));
    if (effects) clauses.push(effects);
    if (usage) clauses.push(usage);
    if (ownership) clauses.push(ownership);
    const all = [...clauses, ...supplementParts.filter(s => !clauses.some(c => c.includes(s)))];
    if (all.length > 0) return all.map(s => s.replace(/[；;]$/, '').trim()).filter(Boolean).join('，') + '。';
  }

  // locations
  {
    const clauses: string[] = [];
    const env = visualFields['environment' as Field] as string | undefined;
    const layout = visualFields['layout' as Field] as string | undefined;
    const atmosphere = visualFields['atmosphere' as Field] as string | undefined;
    const lighting = visualFields['lighting' as Field] as string | undefined;
    const time = visualFields['time' as Field] as string | undefined;
    const actionCtx = visualFields['actionContext' as Field] as string | undefined;
    if (env) clauses.push(env);
    if (layout) clauses.push(layout);
    if (atmosphere) clauses.push(atmosphere);
    if (lighting) clauses.push(lighting);
    clauses.push(...details.filter(d => !clauses.some(c => c.includes(d))));
    if (time) clauses.push(time);
    if (actionCtx) clauses.push(actionCtx);
    const all = [...clauses, ...supplementParts.filter(s => !clauses.some(c => c.includes(s)))];
    if (all.length > 0) return all.map(s => s.replace(/[；;]$/, '').trim()).filter(Boolean).join('。') + '。';
  }

  const fallbackDescription = sourcePack.sourceDescription || input.currentDescription;
  const allParts = fieldParts.length > 0 ? fieldParts : (fallbackDescription ? [fallbackDescription] : []);
  return unique([...allParts, ...visualDetailParts, ...supplementParts]).join('；');
}

function completionStatus(
  sourceCoverage: SourceCoverage,
  inferredFields: string[],
  summarizedFields: string[],
  usedTextOnlyLlmDescription: boolean
): VisualCompletionStatus {
  if (inferredFields.length === 0 && summarizedFields.length === 0 && !usedTextOnlyLlmDescription) return 'source_only';
  return sourceCoverageRank(sourceCoverage) === 0 ? 'llm_inferred' : 'llm_completed';
}

function descriptionSource(status: VisualCompletionStatus, inferredFields: string[]): VisualDescriptionSource {
  if (status === 'source_only') return 'source';
  return inferredFields.length > 0 ? 'mixed' : 'llm';
}

function enhancePack<EntityType extends string, Field extends string>(
  input: CompletionInput<EntityType, Field>,
  llm: CompletionEntity | undefined
): EnhancedEntityDescriptionPack<EntityType, Field> {
  const { visualFields, inferredFields, summarizedFields } = safeLlmFields(input.sourcePack, input.fieldOrder, llm);
  const hasLlmFieldMap = Object.values(llm?.visualFields || {}).some((value) => cleanText(value));
  const visualDetails = cleanVisualDetails(llm?.visualDetails);
  const hasVisualDetails = Object.values(visualDetails).some(Boolean);
  const usedTextOnlyLlmDescription = Boolean(!hasLlmFieldMap && cleanText(llm?.enhancedDescription));
  const status = completionStatus(
    input.sourcePack.sourceCoverage,
    inferredFields,
    summarizedFields,
    usedTextOnlyLlmDescription || hasVisualDetails
  );
  const enhancedDescription = composeEnhancedDescription(
    input,
    input.sourcePack,
    input.fieldOrder,
    visualFields,
    inferredFields,
    summarizedFields,
    llm
  );
  const llmSupplement = inferredFields.length > 0 || usedTextOnlyLlmDescription || hasVisualDetails
    ? cleanLlmSupplement(llm?.llmSupplement)
    : '';
  return {
    ...input.sourcePack,
    visualFields,
    visualDetails,
    inferredFields,
    summarizedFields,
    enhancedDescription,
    finalDescription: enhancedDescription,
    llmSupplement,
    supplementDescription: llmSupplement,
    completionStatus: status,
    descriptionSource: descriptionSource(status, inferredFields),
    needsReview: input.sourcePack.needsReview || inferredFields.length > 0 || status === 'llm_inferred',
  };
}

function countSourceOnly(packs: AnyEnhancedPack[]): number {
  return packs.filter((pack) => pack.completionStatus === 'source_only').length;
}

function countInferred(packs: AnyEnhancedPack[]): number {
  return packs.filter((pack) => pack.inferredFields.length > 0).length;
}

export async function executeVisualDescription(payload: unknown): Promise<VisualDescriptionResult> {
  const source = payload as VisualDescriptionPayload;
  const characters = source.characters || [];
  const items = source.items || [];
  const locations = source.locations || [];

  const characterInputs = collectCompletionInputs(
    'characters',
    'character',
    characters,
    source.characterDescriptions || [],
    CHARACTER_FIELD_ORDER
  );
  const itemInputs = collectCompletionInputs(
    'items',
    'item',
    items,
    source.itemDescriptions || [],
    ITEM_FIELD_ORDER
  );
  const locationInputs = collectCompletionInputs(
    'locations',
    'location',
    locations,
    source.locationDescriptions || [],
    LOCATION_FIELD_ORDER
  );
  const allInputs: AnyCompletionInput[] = [...characterInputs, ...itemInputs, ...locationInputs];
  const llmInputs = allInputs.filter(needsLlmCompletion);
  const completions = new Map<string, CompletionEntity>();

  if (llmInputs.length > 0) {
    const provider = await getDefaultProvider();
    const groups = groupInputs(llmInputs);
    const total = groups.length;

    // One LLM call per group; returns its completion entries. Throws on
    // failure so Promise.allSettled captures it and we fall back to source-only.
    const processGroup = async (
      index: number,
      group: AnyCompletionInput[]
    ): Promise<Array<[string, CompletionEntity]>> => {
      console.log(`[VisualDescription] Processing group ${index + 1}/${total} (${group.length} entities)`);
      const result = await provider.chatExtract(
        VISUAL_DESCRIPTION_SYSTEM_PROMPT,
        buildUserPrompt(group),
        completionSchema
      );
      const entries = [...completionMap(result)];
      console.log(`[VisualDescription] Group ${index + 1}/${total} completed`);
      return entries;
    };

    // Run groups with a concurrency cap (same pattern as extractor batching):
    // ceil(total / MAX_CONCURRENT_GROUPS) rounds instead of `total` serial ones.
    const settled: Array<PromiseSettledResult<Array<[string, CompletionEntity]>>> = [];
    for (let i = 0; i < groups.length; i += MAX_CONCURRENT_GROUPS) {
      const slice = groups.slice(i, i + MAX_CONCURRENT_GROUPS);
      const sliceResults = await Promise.allSettled(
        slice.map((group, j) => processGroup(i + j, group))
      );
      settled.push(...sliceResults);
    }

    for (let index = 0; index < settled.length; index += 1) {
      const result = settled[index];
      if (result.status === 'fulfilled') {
        for (const [key, value] of result.value) {
          completions.set(key, value);
        }
      } else {
        const group = groups[index];
        console.warn(
          `[VisualDescription] LLM completion group ${index + 1}/${total} failed, using source-only descriptions for ${group.length} entities: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`
        );
      }
    }
  }

  const characterVisualDescriptions = characterInputs.map((input) =>
    enhancePack(input, completions.get(outputKey('characters', input.name)))
  );
  const itemVisualDescriptions = itemInputs.map((input) =>
    enhancePack(input, completions.get(outputKey('items', input.name)))
  );
  const locationVisualDescriptions = locationInputs.map((input) =>
    enhancePack(input, completions.get(outputKey('locations', input.name)))
  );
  const enhancedPacks: AnyEnhancedPack[] = [
    ...characterVisualDescriptions,
    ...itemVisualDescriptions,
    ...locationVisualDescriptions,
  ];

  return {
    ...source,
    characters,
    items,
    locations,
    characterVisualDescriptions,
    itemVisualDescriptions,
    locationVisualDescriptions,
    visualDescription: {
      requested: llmInputs.length,
      completed: enhancedPacks.length,
      sourceOnly: countSourceOnly(enhancedPacks),
      inferred: countInferred(enhancedPacks),
    },
  };
}
