import { LOW_CONFIDENCE_THRESHOLD } from '@qunxiang/core';
import type { AgentType, Character, Item, Location } from '@qunxiang/core';
import { getDefaultProvider } from '@qunxiang/llm';
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
- 【关键 — 必须改写而非照抄】sourceFields 中的内容是正则抽取的原文碎片，常混入大量非视觉内容。你不能直接复制 sourceFields 的原文到 visualFields，必须**用自己的语言重新概括**为简洁的视觉描述。例如 sourceFields.appearance = "辛酸一直冲到鼻孔里；路明非舔了舔嘴唇" → 这不是外貌描写，应输出空字符串或"原文未提供明确外貌描写"。例如 sourceFields.clothing = "他们会给路明非套上黑色的军服和长风衣；他穿着一身墨绿色的西装" → visualFields.clothing 应概括为"黑色军服配深色长风衣，或墨绿色西装"。
- 【章节出处保留 — 极重要】sourceFields 中每条片段末尾的"（第x章）"是原文出处标注。你在改写 visualFields 时，必须为每条视觉描写保留或补上对应的"（第x章）"标注。格式：每条描写以"（第x章）"结尾，多条之间用"；"分隔。例如 sourceFields.clothing = "身穿青色劲装（第1章）；一身黑袍遮面（第5章）" → visualFields.clothing 应输出类似"青色劲装（第1章）；宽大黑袍遮掩面容（第5章）"。如果你从 enhancedDescription 或 description 补写了缺失字段，没有章节依据的不加章节标注。
- 【禁例 — 以下内容必须丢弃，不得出现在任何 visualFields 或 enhancedDescription 中】
  · 感官/情绪描写："辛酸冲到鼻孔里""心里一紧""鼻子一酸"
  · 动作描写："舔了舔嘴唇""踢着石头远去""呆呆地看着背影"
  · 叙述/剧情："路明非的语文老师拿他的作文作为反面例子""每次母亲写信来"
  · 比喻/文学性表达："如刀割面""那个钢刀一样的女孩""一刀正中路明非的心头"
  · 非本角色描写：sourceFields 中混入的其他角色的服饰/外貌
- 只有原文缺失的字段，才可以根据简介、人物性格、身份、剧情气质做保守补写。
- 不要把补写内容说成原文描写；补写只放在缺失字段里，并写入 llmSupplement。
- 如果只是概括已有 sourceFields，没有补写缺失字段，llmSupplement 必须留空。
- enhancedDescription 和 llmSupplement 都只写实体视觉描述本身，不要写"原文未描写""enhancedDescription 中"等过程说明。
- 如果原文没有具体外貌/材质/场景描写，允许做克制补全，但不要创造具体到不合理的颜色、服饰纹样、五官细节、材质品牌等硬设定。

【人物 enhancedDescription — 概括性人物描写】
enhancedDescription 是一段概括性的人物视觉描写，必须满足：
1. 用流畅的自然中文写成一段话，读起来像角色设定卡上的外貌概括，而不是原文片段的拼接。
2. 只写该角色**稳定的、可复现的**视觉特征：身材体型、脸型轮廓、整体气质、头发（颜色/长度/样式）、眼睛（颜色/形状/神态）、装束穿着、标志性道具。
3. 不要写一次性动作、临时表情、剧情事件、心理感受。不要照抄原文原句。
4. 如果原文信息不足，宁可简短也不要用非视觉内容凑字数。
——正确示例："少年身材修长偏瘦，瓜子脸清秀，黑色短发，眼神中偶有精光闪过。常穿黑色军服配深色长风衣，或一身墨绿色西装。"
——错误示例（禁止）："路明非的背影踢着石头自由自在地远去。辛酸一直冲到鼻孔里。路明非舔了舔嘴唇。"（这是动作和感官描写，不是外貌概括）
次要人物可简略，但至少包含身材、脸型、气质、装束的关键信息。

【道具 enhancedDescription — 概括性道具描写】
物品/道具写成一段概括性描写，织入：
材质质感、颜色与形状、尺寸大小、状态（新旧/完整/破损）、使用方式、视觉光效（如有）、归属者。
——示例："通体碧绿的丹药约龙眼大小，表面光滑温润，隐隐散发淡绿色光泽，装在古色古香的玉匣中。"

【地点 enhancedDescription — 概括性场景描写】
地点写成一段概括性描写，织入：
整体环境、空间布局与尺度、氛围基调、光线特征、时间感、标志性视觉锚点。
——示例："萧家大厅宽敞肃穆，青砖铺地，四壁悬挂家族旗帜与古字画。正上方设主座与三位长老席位，光线从雕花窗棂透入，映出斑驳光影。"

- 不要生成生图 prompt，不要出现镜头、画幅、风格、模型参数。

只返回 JSON：
{
  "characters": [{"name": "entity name", "visualFields": {"field": "value"}, "visualDetails": {"bodyBuild": "...", "faceShape": "...", "temperament": "...", "hair": "...", "eyes": "...", "nose": "...", "lips": "...", "skin": "...", "makeupStyling": "..."}, "enhancedDescription": "...", "llmSupplement": "..."}],
  "items": [{"name": "entity name", "visualFields": {"field": "value"}, "visualDetails": {"materialTexture": "...", "colorShape": "...", "condition": "...", "scale": "...", "effects": "..."}, "enhancedDescription": "...", "llmSupplement": "..."}],
  "locations": [{"name": "entity name", "visualFields": {"field": "value"}, "visualDetails": {"environment": "...", "layout": "...", "atmosphere": "...", "lighting": "...", "keyVisualAnchors": "..."}, "enhancedDescription": "...", "llmSupplement": "..."}]
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
  return uniquePreservingChapterRef(cleanText(value).split(/[;；。\n]+/u));
}

/**
 * 与 unique 相同，但去重时忽略末尾的（第x章）标注，
 * 保证同一描述片段在不同章节出现时不会被误去重。
 */
function uniquePreservingChapterRef(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const value = raw.trim();
    if (!value) continue;
    // 去重 key 去掉章节标注，但保留原始文本（含章节标注）
    const key = cleanText(value).replace(/（第\d+章）/gu, '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
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

// 叙述性内容的关键词——出现这些说明 source field 是原文碎片而非纯视觉描述。
// sourceFields 是正则从原文抽取的片段，常混入动作叙述、心理活动、因果连接等非视觉内容。
// 视觉概括不会使用这些词，因此含任一关键词即判定为"非纯视觉"。
const NARRATIVE_INDICATORS = [
  // 动作叙述（角色在做某事，而非静态外貌）
  '望着', '看着', '看见', '听见', '听到', '感觉', '发现', '察觉', '盯着',
  '转过', '转身', '站起', '走出', '走了', '走来', '窜到', '逃命', '咬了',
  '缓缓', '对着', '飘出', '飞奔', '跳跃', '叩', '敲', '推门', '拉门',
  '活捉', '抓住', '拿走', '收好', '接过', '递给', '收起', '拿出', '掏出',
  '抬了', '瞪住', '打量', '扫了',
  // 对话/语气
  '说道', '问道', '笑道', '喝道', '怒斥', '吼道', '喊道', '开口', '出声',
  '冷笑', '低语', '大喝', '大笑', '轻笑', '森然', '说着',
  // 叙事连接/时间
  '只见', '忽然', '突然', '片刻', '当时', '当下', '随即', '顿时',
  '紧接着', '下一秒', '随后', '然后', '接着', '此时', '此刻', '此际',
  '之际', '之时',
  // 心理/感官
  '心想', '感到', '觉得', '暗想', '心头', '辛酸', '鼻酸', '心里',
  '发凉', '不安', '寒心', '凄凉', '满意', '愤怒', '惊讶', '感激', '佩服',
  // 因果/转折/条件（原文叙述标志，视觉概括不会用这些）
  '因为', '所以', '但是', '而且', '虽然', '不过', '于是', '如果',
  '因此', '由于', '尽管', '而是', '除了', '其中', '原本', '里面',
  // 世界观/抽象设定
  '斗气', '大陆', '帝国', '宗门', '功法', '斗技', '炼药', '拍卖',
  '坊市', '实力', '凝聚', '境界',
];

/** 判断文本是否含叙述性内容（动作/心理/因果/世界观等非视觉描述） */
function hasNarrativeContent(value: string): boolean {
  if (!value) return false;
  return NARRATIVE_INDICATORS.some((indicator) => value.includes(indicator));
}

/**
 * 判断 source field 是否为纯视觉描述（不含叙述性内容）。
 * sourceFields 是正则抽取的原文碎片，若含叙述词说明它不是纯视觉概括，
 * 应交给 LLM 清洗而非直接保留。
 */
function isPureVisualSource(value: string): boolean {
  if (!value || !value.trim()) return false;
  const parts = splitDescriptionParts(value);
  if (parts.length === 0) return false;
  return !parts.some((part) => hasNarrativeContent(part));
}

/**
 * 清洗 visualFields 值：过滤掉含叙述性内容的片段，只保留纯视觉描述。
 * 用于 composeEnhancedDescription 的 fallback 分支，防止原文叙述碎片混入最终描写。
 */
function cleanVisualFieldValue(value: string | undefined): string {
  if (!value) return '';
  const parts = splitDescriptionParts(value);
  const cleaned = parts.filter((part) => !hasNarrativeContent(part));
  return cleaned.join('；');
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
  if (needsSourceSummary(input)) return true;
  // Major entities always get LLM completion — they need visualDetails for prompt generation
  if (input.priorityHint === 'major') return true;
  // Secondary entities get LLM only when explicitly enabled (VISUAL_DESCRIPTION_SUPPLEMENT_SECONDARY).
  // 默认 source_only——不因 missingFields 就调 LLM，避免给每个次要实体都烧一次调用。
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
1. 已有 sourceFields 中常混入动作叙述、对话引用、世界观设定、感官/情绪描写等非视觉碎片。你必须为每个字段（无论是否 missing）输出清洗后的**纯视觉描述**写入 visualFields。过滤规则：丢弃"望着""走出""说道""斗气大陆""玄阶功法""辛酸冲到鼻孔里""舔了舔嘴唇""踢着石头远去"等非视觉内容，只保留外貌/材质/色彩/形状/尺寸/光线/质感等可视属性。
2. 【必须改写】不要直接复制 sourceFields 的原文到 visualFields。用你自己的语言将原文中的视觉信息概括为简洁描述。如果某个 sourceField 全部都是非视觉内容，visualFields 对应字段输出空字符串。
3. missingFields 按现有规则保守补写。
4. sourceFieldOmittedParts 只表示还有未放入 prompt 的同类证据，不需要处理。

【强制要求 — enhancedDescription 质量】
enhancedDescription 必须是一段概括性的人物/道具/场景视觉描写，用你自己的语言写成流畅的自然中文段落。它不是原文片段的拼接，而是像角色设定卡上的外貌概括。只写稳定的可复现视觉特征，丢弃一次性动作、临时表情、剧情事件、心理感受、文学性比喻。

${JSON.stringify(payload, null, 2)}`;
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
      // source field 含叙述性内容（动作/心理/因果/世界观等）时，即使短也需 LLM 清洗，
      // 否则原文碎片会直接混入 visualFields 并拼进 enhancedDescription。
      const sourceIsDirty = !isPureVisualSource(sourceValue);
      if (llmValue && (shouldSummarizeSourceField(sourceValue) || sourceIsDirty)) {
        // source 长/脏时用 LLM 清洗版（condense）；source 已短而干净则保留下面的 else 分支，
        // 不让 LLM 改写——防止把原文已确认的字段替换成幻觉值（如 black robe→white robe）。
        visualFields[field] = llmValue;
        summarizedFields.push(field);
      } else if (shouldSummarizeSourceField(sourceValue)) {
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
    // source field 含叙述性内容时不保护——LLM 改写它是正确行为（清洗非视觉碎片），
    // 不应因 LLM 偏离了叙述性原文就判定为冲突。
    if (!isPureVisualSource(sourceValue)) continue;
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
    // 用 cleanVisualFieldValue 过滤掉 visualFields 中残留的叙述性原文碎片，
    // 只保留纯视觉描述，防止 fallback 拼出"因为他看到巨汉…"这类原文叙述。
    const appearance = cleanVisualFieldValue(visualFields['appearance' as Field] as string | undefined);
    const clothing = cleanVisualFieldValue(visualFields['clothing' as Field] as string | undefined);
    const body = cleanVisualFieldValue(visualFields['body' as Field] as string | undefined);
    const temperament = cleanVisualFieldValue(visualFields['temperament' as Field] as string | undefined);
    const ability = cleanVisualFieldValue(visualFields['abilityVisuals' as Field] as string | undefined);
    const items = cleanVisualFieldValue(visualFields['signatureItems' as Field] as string | undefined);
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
    const material = cleanVisualFieldValue(visualFields['material' as Field] as string | undefined);
    const colorShape = cleanVisualFieldValue(visualFields['colorShape' as Field] as string | undefined);
    const condition = cleanVisualFieldValue(visualFields['condition' as Field] as string | undefined);
    const usage = cleanVisualFieldValue(visualFields['usage' as Field] as string | undefined);
    const effects = cleanVisualFieldValue(visualFields['visualEffects' as Field] as string | undefined);
    const ownership = cleanVisualFieldValue(visualFields['ownership' as Field] as string | undefined);
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
    const env = cleanVisualFieldValue(visualFields['environment' as Field] as string | undefined);
    const layout = cleanVisualFieldValue(visualFields['layout' as Field] as string | undefined);
    const atmosphere = cleanVisualFieldValue(visualFields['atmosphere' as Field] as string | undefined);
    const lighting = cleanVisualFieldValue(visualFields['lighting' as Field] as string | undefined);
    const time = cleanVisualFieldValue(visualFields['time' as Field] as string | undefined);
    const actionCtx = cleanVisualFieldValue(visualFields['actionContext' as Field] as string | undefined);
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
  // 低置信度实体只保留名字防遗漏，不参与视觉补写（与提示词生成的跳过策略一致）。
  // 注意：这里只过滤「补写输入」，载荷中的实体列表原样向后传递——
  // 低置信度实体要进低置信度库供人工裁决，若在此从载荷删除会导致它们彻底消失。
  const isLowConfidence = (entity: { confidence?: number }) =>
    typeof entity.confidence === 'number' && entity.confidence < LOW_CONFIDENCE_THRESHOLD;
  const completionCharacters = (source.characters || []).filter((e) => !isLowConfidence(e));
  const completionItems = (source.items || []).filter((e) => !isLowConfidence(e));
  const completionLocations = (source.locations || []).filter((e) => !isLowConfidence(e));

  const characterInputs = collectCompletionInputs(
    'characters',
    'character',
    completionCharacters,
    source.characterDescriptions || [],
    CHARACTER_FIELD_ORDER
  );
  const itemInputs = collectCompletionInputs(
    'items',
    'item',
    completionItems,
    source.itemDescriptions || [],
    ITEM_FIELD_ORDER
  );
  const locationInputs = collectCompletionInputs(
    'locations',
    'location',
    completionLocations,
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
    // 实体列表不在本阶段过滤：characters/items/locations 随 source 原样传递，
    // 保证低置信度实体能到达入库阶段（进低置信度库），而非在此消失。
    // locations/items 在输入侧是可选的，这里归一化为数组，与 VisualDescriptionResult 的
    // 非可选声明一致；下游本就以 Array.isArray 守卫，归一化不改变行为。
    locations: source.locations ?? [],
    items: source.items ?? [],
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
