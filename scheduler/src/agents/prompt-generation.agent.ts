import type { AgentType, Character, Item, Location, Outfit, Owner } from '@novel-agent/core';
import { getDefaultProvider } from '@novel-agent/llm';
import { z } from 'zod';
import type {
  CharacterVisualDescriptionPack,
  ItemVisualDescriptionPack,
  LocationVisualDescriptionPack,
} from './visual-description.agent.js';

export const promptGenerationAgentType: AgentType = 'prompt-generation';

// ── Types ──

type CharacterEntity = Omit<Character, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>;
type ItemEntity = Omit<Item, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>;
type LocationEntity = Omit<Location, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>;

/** 角色年龄成长阶段（仅按原文证据识别，不凭空推断） */
export type AgeStage = 'child' | 'youth' | 'young' | 'middle' | 'old';

/** 单个年龄阶段的提示词版本。人物描写须有原文依据、可溯源。 */
export interface PromptVariant {
  stage: AgeStage;
  label: string;
  prompt: string;
  outfit?: string;
  /** 溯源：该版本基于的原文章节区间（来自 outfit/description 证据） */
  sourceChapters?: string;
  /** 其余服饰套系（含章节区间） */
  outfitList?: string[];
  source: 'template-only' | 'llm-polished' | 'llm-fallback';
  isPrimary?: boolean;
}

/** 单套服饰（非主套）对应的完整四视图设计图提示词。生图时可按套系选择。 */
export interface OutfitVariant {
  /** 场景/用途标签（如 "伪装炼药师" "战斗"） */
  scene?: string;
  /** 原文服饰描述 */
  description: string;
  /** 完整四视图提示词（模板生成，可经 LLM 补写） */
  prompt: string;
  /** 溯源：该套出现的章节区间 */
  sourceChapters?: string;
  source: 'template-only' | 'llm-polished' | 'llm-fallback';
}

export interface GenerationPrompt {
  entityName: string;
  entityType: 'character' | 'item' | 'location';
  tier: string;
  prompt: string;
  /** 角色的多个年龄阶段版本（仅 character；顶层 prompt = 主阶段，向后兼容旧读取方） */
  variants?: PromptVariant[];
  /** 非主套服饰套系的完整设计图提示词（仅 character） */
  outfitVariants?: OutfitVariant[];
  /** 识别到的阶段（调试/前端展示） */
  detectedStages?: AgeStage[];
  styleTags: string[];
  source: 'template-only' | 'llm-polished' | 'llm-fallback';
  quality: 'high' | 'medium' | 'low';
  description?: string;
  /** 视觉描写概括（来自 visual-description agent），供 LLM polish 补写"未详述"字段 */
  enhancedDescription?: string;
}

export interface PromptGenerationPayload extends Record<string, unknown> {
  characters: CharacterEntity[];
  locations?: LocationEntity[];
  items?: ItemEntity[];
  characterVisualDescriptions?: CharacterVisualDescriptionPack[];
  itemVisualDescriptions?: ItemVisualDescriptionPack[];
  locationVisualDescriptions?: LocationVisualDescriptionPack[];
}

export interface PromptGenerationResult extends PromptGenerationPayload {
  characters: CharacterEntity[];
  locations: LocationEntity[];
  items: ItemEntity[];
  characterPrompts: GenerationPrompt[];
  itemPrompts: GenerationPrompt[];
  locationPrompts: GenerationPrompt[];
  promptGeneration: {
    total: number;
    llmPolished: number;
    templateOnly: number;
    llmFallback: number;
  };
}

// ── Env config ──

const USE_LLM = process.env.PROMPT_GEN_USE_LLM !== '0';
const LLM_MIN_TIER = process.env.PROMPT_GEN_LLM_MIN_TIER || 'supporting';
const MAX_CHARS = Number(process.env.PROMPT_GEN_MAX_CHARS || 24000);

const TIER_ORDER: Record<string, number> = {
  core: 0,
  supporting: 1,
  candidate: 2,
  archived: 3,
};

// ── Style tags ──

const CHARACTER_STYLE_TAGS = ['古风玄幻', '精致细节', '柔和光影', '高质量CG'];
const LOCATION_STYLE_TAGS = ['古风建筑场景', '电影级光影', '大气透视', '高质量CG'];
const ITEM_STYLE_TAGS = ['实物拍摄质感', '精致细节', '柔和棚拍光', '高质量CG'];

// ── Character design sheet: structured four-view format ──

/**
 * Pick the most representative outfit for the four-view image.
 * Order: widest chapter span → scene labeled 默认/日常 → first in source order.
 */
function pickPrimaryOutfit(outfits: Outfit[]): Outfit | undefined {
  if (outfits.length === 0) return undefined;
  const span = (o: Outfit) => {
    const a = o.firstChapter ?? 0;
    const b = o.lastChapter ?? a;
    return b - a;
  };
  const isDefault = (o: Outfit) => /默认|日常|常服|平时/.test(o.scene || '');
  return outfits.reduce<Outfit>((best, o) => {
    const so = span(o);
    const sb = span(best);
    if (so > sb) return o;
    if (so === sb && isDefault(o) && !isDefault(best)) return o;
    return best;
  }, outfits[0]);
}

/** Render the non-primary outfits (description + scene + chapter range) as a reference list. */
function renderOutfitList(outfits: Outfit[], primary?: Outfit): string[] {
  const rest = primary ? outfits.filter((o) => o !== primary) : outfits.slice();
  if (rest.length === 0) return [];
  const lines = rest.map((o) => {
    const scene = o.scene ? `[${o.scene}]` : '';
    const ch =
      o.firstChapter != null || o.lastChapter != null
        ? `（第${o.firstChapter ?? '?'}-${o.lastChapter ?? '?'}章）`
        : '';
    return `- ${scene}${ch ? ' ' + ch : ''} ${o.description}`.replace(/\s+/g, ' ').trim();
  });
  return ['', '其余服饰套系（参考，非本四视图）：', ...lines];
}

// ── 年龄阶段（仅按原文证据识别，绝不凭空推断；人物描写须可溯源）──

const STAGE_ORDER: AgeStage[] = ['child', 'youth', 'young', 'middle', 'old'];

const STAGE_LABEL: Record<AgeStage, string> = {
  child: '孩童（约6-10岁）',
  youth: '少年（约14-16岁）',
  young: '青年（约20-30岁）',
  middle: '中年（约40-55岁）',
  old: '老年（约60岁以上）',
};

// 阶段对体态的合理倾向（基于年龄段的客观外貌规律，非编造个体特征）
const STAGE_BODY: Record<AgeStage, string> = {
  child: '身形矮小稚嫩',
  youth: '身形单薄、尚未完全长成，略显清瘦',
  young: '身形挺拔修长，体格匀称',
  middle: '体格沉稳厚实，气势内敛',
  old: '身形清瘦略显佝偻',
};

/** 数值年龄 → 阶段 */
function ageNumberToStage(age: number): AgeStage {
  if (age <= 10) return 'child';
  if (age <= 17) return 'youth';
  if (age <= 35) return 'young';
  if (age <= 58) return 'middle';
  return 'old';
}

/** 原文明确写出的年龄词 → 阶段 */
function stageFromKeywords(text: string): AgeStage | null {
  if (/老者|老头|老翁|苍老|白发苍苍|鬓发皆白|灵魂体/.test(text)) return 'old';
  if (/中年|壮年/.test(text)) return 'middle';
  if (/青年/.test(text)) return 'young';
  if (/少年|少女/.test(text)) return 'youth';
  if (/孩童|幼年/.test(text)) return 'child';
  return null;
}

/** 角色出场的章节跨度（原文证据：覆盖的时期范围） */
function computeChapterSpan(pack: any, outfits: Outfit[]): number {
  const chaps: number[] = [];
  if (pack.firstChapter != null) chaps.push(pack.firstChapter);
  if (pack.lastChapter != null) chaps.push(pack.lastChapter);
  for (const o of outfits) {
    if (o.firstChapter != null) chaps.push(o.firstChapter);
    if (o.lastChapter != null) chaps.push(o.lastChapter);
  }
  if (chaps.length < 2) return 0;
  return Math.max(...chaps) - Math.min(...chaps);
}

/**
 * 按原文证据识别角色跨越的年龄阶段（纯规则，不调 LLM）。
 * 默认只返回当前阶段；仅在原文有明确证据（老年词/成长时间线+章节跨度）时扩展。
 */
function detectAgeStages(pack: any, tier: string): { stages: AgeStage[]; primary: AgeStage } {
  const desc = pack.description || '';
  const statusMarkers = pack.visualFields?.statusMarkers || '';
  // outfits 的 description 常含角色年龄/样子线索（如"枯瘦老翁""三十来岁精壮男子"），作为阶段证据
  const outfitText = (Array.isArray(pack.outfits) ? pack.outfits : [])
    .map((o: any) => `${o.scene || ''} ${o.description || ''}`)
    .join(' ');
  const text = `${desc} ${statusMarkers} ${outfitText}`;
  // 主语部分（desc 前 80 字）+ outfit 描述：年龄词判断用。outfit description 常含角色年龄/样子
  // （如"枯瘦老翁""三十来岁"），纳入可识别 outfit 里显式的阶段；desc 只取前 80 字避免匹配后段描述别人的词。
  const head = `${desc.slice(0, 80)} ${statusMarkers} ${outfitText}`.slice(0, 300);
  const outfits: Outfit[] = Array.isArray(pack.outfits) ? pack.outfits : [];

  // 当前阶段（锚点，必有）：优先原文明确年龄词（避免成长数字干扰），其次数值年龄
  const currentAge = findCurrentAge(text);
  const currentStage: AgeStage =
    stageFromKeywords(head) ??
    (currentAge != null ? ageNumberToStage(currentAge) : null) ??
    (tier === 'core' ? 'youth' : 'young');

  const stages = new Set<AgeStage>([currentStage]);

  // 老年证据（原文明确写老者/白发/灵魂体；若有巅峰回忆则补中年——均有原文依据）
  const hasOldKw = /老者|老头|老翁|苍老|白发苍苍|鬓发皆白|灵魂体/.test(head);
  const hasFlashbackPeak = /巅峰|当年|年轻时|昔日|曾经|全盛|曾是/.test(text);
  if (hasOldKw) {
    stages.add('old');
    if (hasFlashbackPeak) stages.add('middle');
  }

  // 成长型证据（原文成长时间线 / 多个年龄数字 / 多套服饰）；重要角色才扩展
  const hasGrowthTimeline = /数年后|多年后|几年后|数载|时光|岁月|从小|自幼|长大后|成长|蜕变|重新崛起|天赋|天才少年|天才/.test(text);
  const ageNumberCount = (text.match(/(\d{1,3}|[一二三四五六七八九]?十[一二三四五六七八九]?|一百[一二三四五六七八九]?)\s*岁/g) || []).length;
  const hasGrowthEvidence = hasGrowthTimeline || ageNumberCount >= 2 || outfits.length >= 2;
  const isProtagonist = tier === 'core' || (pack.mentionCount ?? 0) >= 100;
  if (!hasOldKw && isProtagonist && hasGrowthEvidence) {
    stages.add('youth');
    stages.add('young');
    // 注：child 阶段不在成长型里自动加——description 常提到别人的孩童年龄（如"韩立七岁"），
    // 仅当该角色当前就是孩童（currentStage=child）时才保留，避免误匹配。
  }

  const stageList = STAGE_ORDER.filter((s) => stages.has(s));
  // primary：成长型角色不以"孩童"作主阶段（故事主体通常是少年/青年，孩童是起点）
  let primary = currentStage;
  if (primary === 'child' && stages.has('youth')) primary = 'youth';
  else if (primary === 'child' && stages.has('young')) primary = 'young';
  return { stages: stageList, primary };
}

/**
 * 生成单个年龄阶段的设计图提示词。个体特征（面部/发型/标志物/服装）来自原文
 * visualFields/visualDetails/outfits（可溯源）；仅体态/年龄行按阶段调整（年龄段客观规律）。
 * 返回该阶段 prompt + 溯源元数据（outfit/章节区间）。
 */
function buildCharacterDesignSheet(pack: any, stage?: AgeStage, forcedOutfit?: Outfit): {
  prompt: string;
  outfit?: string;
  sourceChapters?: string;
  outfitList?: string[];
} {
  const tier = pack.tier || 'candidate';
  const vf = pack.visualFields || {};
  const vd = pack.visualDetails || {};
  const desc = pack.description || '';

  // 个体特征（原文依据，跨阶段不变，保证"同一人"）
  const rawBody = pickOne(vd, vf, 'bodyBuild', 'body');
  const faceShape = pickOne(vd, vf, 'faceShape', 'appearance');
  const hair = pickOne(vd, vf, 'hair');
  const eyes = pickOne(vd, vf, 'eyes');
  const nose = pickOne(vd, vf, 'nose');
  const lips = pickOne(vd, vf, 'lips');
  const skin = pickOne(vd, vf, 'skin');
  const temperament = pickOne(vd, vf, 'temperament');
  const makeup = pickOne(vd, vf, 'makeupStyling');
  const outfits: Outfit[] = Array.isArray(pack.outfits) ? pack.outfits : [];
  const primaryOutfit = pickPrimaryOutfit(outfits);
  const items = cleanVisualField(vf.signatureItems || '');
  const ability = cleanVisualField(vf.abilityVisuals || '');
  const statusMarkers = (vf.statusMarkers || '').trim();

  // 阶段相关变量（stage 版本按阶段；默认 stage=undefined 时用原文/主套）
  const { primary: primaryStage } = detectAgeStages(pack, tier);
  const effStage = stage ?? primaryStage;
  // 服装：指定套系时强制用该套（服饰套系专属设计图）；否则统一用主套。
  // outfit 的章节区间是剧情时间≠角色年龄，按章节选 outfit 对应阶段会错乱
  // （如墨大夫"老翁装"在第40章却被选给青年）。阶段差异靠体态/年龄行体现，服装保持原文可溯源。
  const stageOutfit = forcedOutfit ?? primaryOutfit;
  const clothing = stageOutfit?.description || pickOne(vd, vf, 'clothing');
  // 体态：stage 版本用年龄段客观规律（非个体编造）；默认用原文 body
  const body = stage ? STAGE_BODY[effStage] : (rawBody || '未详述');
  const ageHint = stage ? STAGE_LABEL[effStage] : buildAgeHint(tier, desc, statusMarkers);

  // 标志性特征（原文依据）
  const signatureParts: string[] = [];
  if (items && items !== '无') signatureParts.push(items);
  if (ability) signatureParts.push(ability);
  const signature = signatureParts.filter((s) => s && s !== '无').join('；') || '无突出标志性特征';

  // 面部（原文依据，片段去重）
  const faceFragments = [faceShape, eyes, nose, lips, skin]
    .filter((s) => s && s !== '未详述')
    .flatMap((s) => s.split(/[。；;]/).map((x) => x.trim()).filter(Boolean));
  const seenFace = new Set<string>();
  const faceCombinedDedup = faceFragments.filter((f) => {
    const k = f.slice(0, 6);
    if (seenFace.has(k)) return false;
    seenFace.add(k);
    return true;
  });
  const faceCombined = faceCombinedDedup.length > 0 ? faceCombinedDedup.join('；') : '未详述';

  const sections = [
    `★ 标志性特征：${signature}`,
    `- 服装/配色：${clothing || '未详述'}`,
    `- 面部/五官：${faceCombined}`,
    `- 发型：${hair || '未详述'}`,
    `- 体态/身形：${body}`,
    `- 神情/气质：${temperament || '未详述'}`,
    `- 年龄/身份视觉线索：${ageHint}`,
  ];
  if (makeup && makeup !== '未详述') sections.push(`- 妆造：${makeup}`);

  const stageSuffix = stage
    ? forcedOutfit
      ? `（${STAGE_LABEL[effStage]}·${forcedOutfit.scene || '套系'}服饰）`
      : `（${STAGE_LABEL[effStage]}）`
    : '';
  const template = [
    `四视图角色设定图 —— ${pack.name}${stageSuffix}`,
    '---',
    '角色设定拆解',
    ...sections,
    '---',
    '四视图要求：同一人物，正面全身、侧面全身、背面全身、面部特写。服装、体型、发型、饰物四个角度保持一致。' + CHARACTER_STYLE_TAGS.join('，') + '。',
  ].join('\n');

  const usedOutfit = stageOutfit || primaryOutfit;
  const sourceChapters =
    usedOutfit && (usedOutfit.firstChapter != null || usedOutfit.lastChapter != null)
      ? `第${usedOutfit.firstChapter ?? '?'}-${usedOutfit.lastChapter ?? '?'}章`
      : undefined;

  // 其余服饰列表（含章节区间，可溯源）；套系专属图不再附参考列表
  const outfitList = forcedOutfit ? [] : renderOutfitList(outfits, primaryOutfit);
  const templateWithOutfits = outfitList.length > 0
    ? `${template}\n\n${outfitList.join('\n')}`
    : template;

  return { prompt: templateWithOutfits, outfit: usedOutfit?.description, sourceChapters, outfitList };
}

/**
 * 为角色生成多个年龄阶段版本（仅按原文证据识别的阶段）。
 * 全部 template 秒出（无 LLM）；顶层 prompt = 主阶段（向后兼容旧读取方）；variants 含全部阶段。
 */
function buildCharacterDesignSheetMultiStage(pack: any): GenerationPrompt {
  const tier = pack.tier || 'candidate';
  const mentionCount = pack.mentionCount ?? 0;
  const importanceScore = pack.importanceScore ?? 0;
  const { stages, primary: primaryStage } = detectAgeStages(pack, tier);

  const variants: PromptVariant[] = stages.map((st) => {
    const sheet = buildCharacterDesignSheet(pack, st);
    return {
      stage: st,
      label: STAGE_LABEL[st],
      prompt: sheet.prompt,
      outfit: sheet.outfit,
      sourceChapters: sheet.sourceChapters,
      outfitList: sheet.outfitList,
      source: 'template-only' as const,
      isPrimary: st === primaryStage,
    };
  });

  const primaryVariant = variants.find((v) => v.isPrimary) ?? variants[0];
  const needsPolish = needsLlmPolish(tier, mentionCount, importanceScore);

  return {
    entityName: pack.name,
    entityType: 'character',
    tier,
    prompt: primaryVariant?.prompt ?? '',
    variants,
    detectedStages: stages,
    styleTags: CHARACTER_STYLE_TAGS,
    source: needsPolish ? 'llm-polished' : 'template-only',
    quality: needsPolish ? 'high' : 'medium',
    description: pack.description || (pack as any).currentDescription || '',
    enhancedDescription: pack.enhancedDescription || pack.finalDescription || '',
  };
}

// LLM 保守输出时的无意义占位，pickOne 应跳过并 fallback 到 visualFields / 下一个 key。
const PLACEHOLDER_RE = /原文未描写|未描写|未提及|^不详$|^未知$|^无$/;

function pickOne(vd: any, vf: any, ...keys: string[]): string {
  for (const k of keys) {
    const raw = ((vd[k] || vf[k] || '').trim());
    if (raw.length <= 1) continue;
    if (PLACEHOLDER_RE.test(raw)) continue;
    const cleaned = cleanVisualField(raw);
    if (cleaned) return cleaned;
  }
  return '';
}

// 中文数字串 → int（"十一"→11, "二十三"→23, "一百二"→102）
function cnNumeralToInt(s: string): number | null {
  const d: Record<string, number> = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
  let m = s.match(/^([一二三四五六七八九])?十([一二三四五六七八九])?$/);
  if (m) return (m[1] ? d[m[1]] : 1) * 10 + (m[2] ? d[m[2]] : 0);
  m = s.match(/^一百([一二三四五六七八九])?$/);
  if (m) return 100 + (m[1] ? d[m[1]] : 0);
  return null;
}

// 提取"当前"年龄：优先"已达/现年/年方"等明确表达；排除过去事件（"X岁时""X岁那年"，如"十一岁时""十岁那年"）
function findCurrentAge(text: string): number | null {
  const tail = (m: RegExpMatchArray) => text.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 2);
  const isPast = (m: RegExpMatchArray) => tail(m)[0] === '时' || tail(m).startsWith('那年');
  const explicit = text.match(/(?:已达|现年|如今|今年|年方|年仅|年约|约)\s*(\d{1,3})\s*岁/);
  if (explicit) return Number(explicit[1]);
  for (const m of text.matchAll(/(\d{1,3})\s*岁/g)) {
    if (isPast(m)) continue;
    return Number(m[1]);
  }
  for (const m of text.matchAll(/([一二三四五六七八九]?十[一二三四五六七八九]?|一百[一二三四五六七八九]?)岁/g)) {
    if (isPast(m)) continue;
    const n = cnNumeralToInt(m[1]);
    if (n != null) return n;
  }
  return null;
}

function buildAgeHint(tier: string, description: string, statusMarkers?: string): string {
  // 扫描完整 description + statusMarkers（年龄/身份线索常散落其中，如"十一岁""三星斗者"）
  const text = `${description || ''} ${statusMarkers || ''}`;
  // 当前年龄：优先"已达/现年/年方"等明确表达，排除"X岁时"（过去事件，如"十一岁时仅八段斗之气"）
  const age = findCurrentAge(text);
  if (age != null) return `${age}岁左右`;
  // Age-stage keywords — scan full text (年龄关键词可能在描述后段)
  const ageWords: [string, string][] = [
    ['老者', '老年（约60岁以上）'], ['老头', '老年'], ['老翁', '老年'],
    ['苍老', '老年'], ['白发苍苍', '老年'],
    ['中年男子', '中年男子（约40-55岁）'], ['中年人', '中年'], ['中年', '中年（约40-55岁）'],
    ['壮年', '壮年（约30-40岁）'],
    ['年轻人', '青年（约20-30岁）'], ['青年', '青年（约20-30岁）'],
    ['少年', '少年（约14-16岁）'], ['少女', '少女（约14-16岁）'],
    ['孩童', '孩童'], ['幼年', '幼年'], ['稚嫩', '年少'],
  ];
  for (const [w, hint] of ageWords) {
    if (text.includes(w)) return hint;
  }
  if (tier === 'core') return '少年/青年（主角）';
  if (tier === 'supporting') return '中青年';
  // 身份/实力线索（statusMarkers 常含"三星斗者""宗主"等视觉可辨的身份符号）
  const sm = (statusMarkers || '').trim();
  if (sm && !PLACEHOLDER_RE.test(sm)) return sm;
  // 找不到具体年龄/身份时返回空，由模板显示中性占位（不再硬编码"不详"）
  return '';
}

const LOCATION_VIEW_HINT = '全景视角，广角构图，景深层次分明';
const ITEM_DISPLAY_HINT = '产品展示视角，主体突出，纯色背景';

// ── Template builders ──

// Filter: keep only fragments that describe still visual traits (body/face/clothing/color)
const VISUAL_CHARS = new Set('身材形貌穿佩戴饰彩色泽光髻鬓睫眉眸瞳眼鼻唇角唇耳颌颊手掌指纹臂腕拳指背脊胸腹腰臀腿膝踝足履肌肤冠冕袍衫裳裙裾甲胄铠靴屐履襟袖带领璎珞簪钗环镯链玉珠金铁铜银石骨木丝帛锦缎绢纱棉絮毛皮鳞羽绫罗艳丽妆扮扮像神态质纹理脉络痕印标记符号印徽章款式造型轮廓剪影通俊俏丽美秀妍媚妖艳娇楚鲜嫩滑腻温凉冷热瘦胖丰腴枯槁魁梧挺拔颀修短矮伏佝偻苍白皙干净洁白素雅绚丽璀璨华贵气派豁然开朗豁亮阴暗幽邃澄澈绰约雍容凝重厚薄轻重刚柔棱圆尖锐钝破旧新古淡浓浅深明暗赤橙黄绿青蓝紫黑白灰金银棕褐翠棠绯绛碧苍茜朱殷玄黛彤').add('');

// Quick visual check without giant regex
function looksVisual(fragment: string): boolean {
  for (let i = 0; i < fragment.length; i++) {
    if (VISUAL_CHARS.has(fragment[i])) return true;
  }
  return false;
}

// Narrative action keywords (short, common patterns)
function hasNarrativeVerb(fragment: string): boolean {
  const verbs = ['望着','看着','听见','听到','感觉','发现','察觉','盯着','转过头','转过身','站起身','走了出来','走出了','笑了笑','落寞','尴尬','回到','窜到','逃命','狼狈','咬了咬','暗想','心头','缓缓','对着','飘出','飞奔','跳','跃','叩','敲','推门','拉门','说道','问道','笑道','喝道','怒斥','吼道','喊道','开口','出声','冷笑','低语','大喝','大笑','轻笑','森然','说着','只见','忽然','突然','片刻','当时','当下','随即','顿时','紧接着','下一秒','我先','瞪住','抬了抬','微沉','茫然','愕然','交出','接过','递给','收起','拿出','掏出','收好'];
  if (verbs.some(v => fragment.includes(v))) return true;
  // Non-visual world-building / abstract concepts
  const nonVisual = ['斗气','大陆','帝国','宗门','功法','斗技','炼药','拍卖','坊市','已经','应该','便是','就是','只听','随着','听着','全是','所有','任何','何等','不愧','被','瞪住','感知','实力','凝聚'];
  if (nonVisual.some(v => fragment.includes(v))) return true;
  return false;
}

function cleanVisualField(text: string): string {
  if (!text) return '';
  const fragments = text.split(/[;；。，,\n]+/).map((s: string) => s.trim()).filter(Boolean);
  const cleaned = fragments.filter((f: string) => {
    if (f.length < 3) return false;
    if (!looksVisual(f)) return false;
    if (hasNarrativeVerb(f)) return false;
    return true;
  });
  const seen = new Set<string>();
  const result = cleaned.filter((f: string) => {
    const key = f.slice(0, 8);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return result.join('。');
}

/**
 * 剥离文本中所有章节出处标注，保留归属者备注等有用信息。
 *
 * 匹配格式：
 *   - （第x章）→ 整体移除
 *   - （第x-y章）→ 整体移除
 *   - （第x章，备注）→ 移除章节号，保留（备注）
 *   - （第x-y章，备注）→ 移除章节号，保留（备注）
 */
function stripChapterRef(text: string): string {
  return text
    // 有备注：去掉"第x章，"，保留（备注）
    .replace(/（第[\d?]+-?[\d]*章[，,、]\s*/gu, '（')
    // 无备注：去掉整个（第x章）
    .replace(/（第[\d?]+-?[\d]*章）/gu, '')
    // 清理空括号和多余分号
    .replace(/（\s*）/gu, '')
    .replace(/；{2,}/gu, '；')
    .replace(/^；|；$/gu, '')
    .trim();
}

function needsLlmPolish(tier?: string, mentionCount?: number, importanceScore?: number): boolean {
  if (!USE_LLM) return false;
  // tier-based: core/supporting always polished
  if (tier && (TIER_ORDER[tier] ?? 99) <= (TIER_ORDER[LLM_MIN_TIER] ?? 99)) return true;
  // mentionCount fallback: tier is often lost through the pipeline; high-mention characters are major
  if ((mentionCount ?? 0) >= 20) return true;
  if ((importanceScore ?? 0) >= 0.4) return true;
  return false;
}

/**
 * 判断是否因"未详述"字段而需要 LLM polish。
 * 当模板生成的 prompt 含"未详述"且实体有 description 或 enhancedDescription 时，
 * 触发 LLM polish 让其从已有描述中补写缺失的视觉字段。
 */
function needsPolishForUnset(prompt: string, hasDescription: boolean, hasEnhancedDescription: boolean): boolean {
  if (!USE_LLM) return false;
  if (!hasDescription && !hasEnhancedDescription) return false;
  return /未详述/.test(prompt);
}

// ── Pure-visual composers (only visual information, no backstory / power level / social status) ──
// Strategy: visualDetails (LLM-generated, structured, clean) first, visualFields (regex-sourced, may have noise) as fallback

function pickDetails(pack: any, ...keys: string[]): string[] {
  const vd = pack.visualDetails || {};
  const result: string[] = [];
  for (const k of keys) {
    const v = (vd[k] || '').trim();
    if (v && v.length > 1) result.push(v);
  }
  return result;
}

function pickField(pack: any, key: string): string {
  const vf = pack.visualFields || {};
  const raw = (vf[key] || '').trim();
  return cleanVisualField(raw);
}

function composeCharacterVisual(pack: any): string {
  // Primary: visualDetails (LLM-generated, clean structured data)
  const parts: string[] = [];
  // Body → face → hair → eyes → other facial → skin → clothing → items
  parts.push(...pickDetails(pack, 'bodyBuild'));
  parts.push(...pickDetails(pack, 'faceShape'));
  parts.push(...pickDetails(pack, 'hair'));
  parts.push(...pickDetails(pack, 'eyes'));
  parts.push(...pickDetails(pack, 'nose'));
  parts.push(...pickDetails(pack, 'lips'));
  parts.push(...pickDetails(pack, 'skin'));
  parts.push(...pickDetails(pack, 'temperament'));
  parts.push(...pickDetails(pack, 'makeupStyling'));

  // Fallback: if visualDetails are sparse, supplement from visualFields
  if (parts.length < 4) {
    parts.push(pickField(pack, 'body'));
    parts.push(pickField(pack, 'appearance'));
    parts.push(pickField(pack, 'clothing'));
  }

  // If still sparse, prefer enhancedDescription over forcing broken fragments
  if (parts.filter(Boolean).length < 3 && pack.enhancedDescription) {
    const fd = (pack.enhancedDescription || '').trim();
    return fd.length <= 250 ? fd : fd.slice(0, 250);
  }

  // Signature items (from visualFields — more reliable for items)
  const sigItems = pickField(pack, 'signatureItems');
  if (sigItems) parts.push(sigItems);

  if (parts.filter(Boolean).length > 0) {
    return parts.filter(Boolean).join('。');
  }
  // Last resort: use finalDescription but truncated
  const fd = (pack.finalDescription || pack.enhancedDescription || '').trim();
  return fd.length <= 200 ? fd : fd.slice(0, 200);
}

/** Render item owners as one line: 名（第a-b章，note）；名... (uses canonical name when available). */
function renderOwnerLine(owners: Owner[]): string {
  return owners
    .map((o) => {
      const name = o.canonicalName || o.name;
      const ch =
        o.firstChapter != null || o.lastChapter != null
          ? `（第${o.firstChapter ?? '?'}-${o.lastChapter ?? '?'}章）`
          : '';
      const note = o.note ? `，${o.note}` : '';
      return `${name}${ch}${note}`;
    })
    .join('；');
}

function buildCharacterPrompt(pack: CharacterVisualDescriptionPack): GenerationPrompt {
  return buildCharacterDesignSheetMultiStage(pack);
}

function buildLocationPrompt(pack: LocationVisualDescriptionPack): GenerationPrompt {
  const tier = (pack as any).tier || 'candidate';
  const vf = pack.visualFields || {};
  const vd = pack.visualDetails || {};

  const environment = pickOne(vd, vf, 'environment') || '未详述';
  const layout = pickOne(vd, vf, 'layout') || '未详述';
  const atmosphere = pickOne(vd, vf, 'atmosphere') || '未详述';
  const lighting = pickOne(vd, vf, 'lighting') || '未详述';
  const time = pickOne(vd, vf, 'time') || '未详述';
  const anchors = pickOne(vd, vf, 'keyVisualAnchors', 'actionContext') || '未详述';

  const sections = [
    `- 整体环境：${environment}`,
    `- 空间布局：${layout}`,
    `- 氛围基调：${atmosphere}`,
    `- 光线特征：${lighting}`,
    `- 时间感：${time}`,
    `- 标志性视觉锚点：${anchors}`,
  ];

  const template = [
    `场景设定图 —— ${pack.name}`,
    '---',
    '场景设定拆解',
    ...sections,
    '---',
    '全景要求：广角构图，景深层次分明，完整展现空间规模、布局与氛围。' + LOCATION_STYLE_TAGS.join('，') + '。',
    '分镜要求：基于这张场景图，改变摄像机的位置和角度，生成同一场景不同视角的分镜；以平视视角为主，共9个镜头，按3×3九宫格形式排列返回；空间布局、光线、氛围与标志性视觉锚点在各分镜中保持一致。',
  ].join('\n');

  const needsPolish = needsLlmPolish(tier);
  return {
    entityName: pack.name,
    entityType: 'location',
    tier,
    prompt: template,
    styleTags: LOCATION_STYLE_TAGS,
    source: needsPolish ? 'llm-polished' : 'template-only',
    quality: needsPolish ? 'high' : 'medium',
    description: (pack as any).description || (pack as any).currentDescription || '',
    enhancedDescription: pack.enhancedDescription || pack.finalDescription || '',
  } as GenerationPrompt;
}

function buildItemPrompt(pack: ItemVisualDescriptionPack): GenerationPrompt {
  const tier = (pack as any).tier || 'candidate';
  const vf = pack.visualFields || {};
  const vd = pack.visualDetails || {};

  const material = pickOne(vd, vf, 'materialTexture', 'material') || '未详述';
  const colorShape = pickOne(vd, vf, 'colorShape') || '未详述';
  const condition = pickOne(vd, vf, 'condition') || '未详述';
  const scale = pickOne(vd, vf, 'scale') || '未详述';
  const effects = pickOne(vd, vf, 'effects', 'visualEffects') || '未详述';
  const usage = pickOne(vd, vf, 'usage') || '未详述';
  const owners: Owner[] = Array.isArray((pack as any).owners) ? (pack as any).owners : [];
  const ownerLine = owners.length > 0 ? renderOwnerLine(owners) : '';

  const sections = [
    `- 材质质感：${material}`,
    `- 颜色与形状：${colorShape}`,
    `- 状态：${condition}`,
    `- 尺寸：${scale}`,
    `- 视觉光效：${effects}`,
    `- 用途：${usage}`,
  ];
  if (ownerLine) sections.push(`- 归属者：${ownerLine}`);

  const template = [
    `道具设定图 —— ${pack.name}`,
    '---',
    '道具设定拆解',
    ...sections,
    '---',
    '展示要求：产品展示视角，主体突出，纯色背景，多角度呈现材质、形制与细节。' + ITEM_STYLE_TAGS.join('，') + '。',
  ].join('\n');

  const needsPolish = needsLlmPolish(tier);
  return {
    entityName: pack.name,
    entityType: 'item',
    tier,
    prompt: template,
    styleTags: ITEM_STYLE_TAGS,
    source: needsPolish ? 'llm-polished' : 'template-only',
    quality: needsPolish ? 'high' : 'medium',
    description: (pack as any).description || (pack as any).currentDescription || '',
    enhancedDescription: pack.enhancedDescription || pack.finalDescription || '',
  } as GenerationPrompt;
}

// ── LLM polish ──

const POLISH_CHARACTER_PROMPT = `你是角色设定图润色 agent。任务：把模板生成的四视图角色设定图优化为**详细、可直接生图**的专业提示词，让每个角色特点鲜明、辨识度高。

核心目标：突出该角色区别于其他角色的独有视觉特征。

【补写未详述字段 — 极重要】
模板生成的 prompt 中常有"未详述"字段。输入数据里提供了两个字段供你补写：
- enhancedDescription：视觉描写概括（已从原文提取的视觉信息，优先从这里提取身材/脸型/发型/眼睛/肤色/服装/气质等）
- description：角色剧情描述（含身份、经历、关系等，可推断年龄/身份视觉线索）
当某字段为"未详述"时：先从 enhancedDescription 提取对应的视觉信息补写；enhancedDescription 没有的，再从 description 合理推断后补写。只有两个来源都完全无依据时，才保留"未详述"或删去该行。

【章节出处保留 — 极重要】
templatePrompt 中每条视觉描写末尾的"（第x章）"是原文出处标注。你在润色时必须为每条视觉描写保留对应的"（第x章）"标注。格式：每条描写以"（第x章）"结尾，多条之间用"；"分隔。如果你从 enhancedDescription 或 description 补写了缺失字段，没有章节依据的不加章节标注。

逐项要求（对主要人物 core/supporting，以及任何登场次数高的人物，必须全部充实到可生图程度）：

★ 标志性特征：这是整张设定图最重要的一行。挑出 1-3 个**只有这个角色才有**的视觉锚点（如：手指上的黑色古戒、眸中的金色火焰、半透明的灵魂体、胸口的七星徽记、修长的长腿等）。如果模板已给出，确认它确实是最具辨识度的；如果模板是”无突出标志性特征”，从 description 和其他字段里找出真正独特的特征补上。

- 服装/配色：必须具体到款式+颜色+材质+纹样+腰饰/靴子。如”萧家青色劲装，袖口绣暗纹，腰束玄色布带，脚踏黑色短靴”。不允许只写”青色衣衫”这类过于简略的描述。从 outfits/description 推断合理细节。

- 面部/五官：按 脸型→眉眼→鼻→唇→肤色 顺序，每项都给具体描述。如”清秀瓜子脸，下颌略尖；漆黑深邃的眼眸，目光平静时内敛；高挺鼻梁；薄唇紧抿常带苦涩弧度；肤色偏白略显苍白”。

- 发型：发色+长度+样式（束/散/髻/辫）。如”乌黑长发随意束在脑后，几缕碎发垂落额前”。

- 体态/身形：身高感+体型+姿态。如”身形修长挺拔但略显单薄，少年身板尚未完全长成”。

- 神情/气质：核心气质词。如”眼神透着与年龄不符的坚定与隐忍，落寞时与周围格格不入”。

- 年龄/身份视觉线索：根据 description 和 enhancedDescription 推断具体年龄阶段（少年/青年/中年/老年）+ 身份视觉符号（族长/弟子/炼药师等）。如果是"未详述"或"不详"，必须从 enhancedDescription 优先提取，其次从 description 推断后填上。

次要人物（candidate/archived，登场很少）：精简非视觉叙述，未详述字段优先从 enhancedDescription/description 补写，确实无视觉依据的可删整行，但标志性特征和服装/面部必须保留。

格式约束：
- 保持”四视图角色设定图 —— 角色名”和”角色设定拆解”结构
- 末尾保留四视图要求 + “古风玄幻，精致细节，柔和光影，高质量CG”
- 同一人物四视图（正面/侧面/背面/面部特写）服装、体型、发型、饰物必须一致
- 不添加原文完全没有的角色特征（如不要凭空给角色加纹身、伤疤）

只返回 JSON。`;

const POLISH_ITEM_LOCATION_PROMPT = `你是生图提示词润色 agent。任务：将模板生成的"场景设定图/道具设定图"优化为可直接用于 AI 生图的专业提示词。

规则：
- 保持"场景设定图/道具设定图 —— 名称"的结构格式不变
- 保持"设定拆解"的逐项字段；未详述的字段优先从 enhancedDescription（视觉描写概括）提取对应信息补写，其次从 description 做保守视觉推断，确实无依据的可删除整行
- 主要实体（core/supporting）：补全缺失字段的保守视觉推断，强化最具辨识度的视觉特征
- 次要实体：精简冗余，移除与主视觉无关的叙述
- 末尾"全景要求/展示要求/分镜要求"行保留构图、风格标签与九宫格分镜指令
- 严格只保留视觉相关内容，不添加原文没有的设定
- 道具的"归属者"行仅作设定参考，不要写进画面（除非该持有者本就要入画）
- 【章节出处保留】templatePrompt 中每条视觉描写末尾的"（第x章）"是原文出处标注，润色时必须保留。没有章节依据的补写内容不加标注。

只返回 JSON。`;

// chatExtract 返回结构：每条实体对应一个 polishedPrompt。LLM 可能用不同字段名
// (polishedPrompt / prompt / polished / output / content)，全部宽松接收。
const polishEntitySchemaRaw = z.object({
  name: z.string(),
  polishedPrompt: z.string().optional(),
  prompt: z.string().optional(),
  polished: z.string().optional(),
  output: z.string().optional(),
  content: z.string().optional(),
}).passthrough();

function extractPolished(entry: any): string {
  return (entry.polishedPrompt || entry.prompt || entry.polished || entry.output || entry.content || '').trim();
}

const polishSchema = z.object({
  prompts: z.array(polishEntitySchemaRaw).optional().default([]),
  characters: z.array(polishEntitySchemaRaw).optional().default([]),
  items: z.array(polishEntitySchemaRaw).optional().default([]),
  locations: z.array(polishEntitySchemaRaw).optional().default([]),
}).passthrough();

async function polishWithLlm(prompts: GenerationPrompt[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (prompts.length === 0) return result;

  const provider = await getDefaultProvider();
  const chars = prompts.filter(p => p.entityType === 'character');
  const others = prompts.filter(p => p.entityType !== 'character');

  // Polish characters with dedicated prompt
  if (chars.length > 0) {
    try {
      const payload = {
        prompts: chars.map(p => ({
          name: p.entityName, entityType: p.entityType, tier: p.tier,
          templatePrompt: p.prompt,
          description: (p as any).description || '',
          enhancedDescription: p.enhancedDescription || '',
        })),
      };
      const llmResult = await provider.chatExtract(
        POLISH_CHARACTER_PROMPT,
        `请润色以下角色设定图。每个实体的 templatePrompt 是模板生成的初版，你必须返回润色后的完整四视图文本。

输出格式（严格遵守，不要回显输入字段）：
{
  "prompts": [
    {"name": "萧炎", "polishedPrompt": "四视图角色设定图 —— 萧炎\\n---\\n角色设定拆解\\n★ 标志性特征：...\\n- 服装/配色：...\\n- 面部/五官：...\\n- 发型：...\\n- 体态/身形：...\\n- 神情/气质：...\\n- 年龄/身份视觉线索：...\\n---\\n四视图要求：...古风玄幻，精致细节，柔和光影，高质量CG。"}
  ]
}

输入数据：
${JSON.stringify(payload, null, 2)}`,
        polishSchema
      );
      const all = [...(llmResult.prompts ?? []), ...(llmResult.characters ?? [])];
      let ok = 0;
      for (const entry of all) {
        const text = extractPolished(entry);
        if (text && entry.name) { result.set(entry.name, text); ok++; }
      }
      console.log(`[PromptGeneration] Character polish: ${ok}/${chars.length} succeeded`);
    } catch (error) {
      const msg = error instanceof Error ? `${error.message}\n${error.stack?.slice(0, 500) || ''}` : String(error);
      console.warn(`[PromptGeneration] Character polish failed for ${chars.length} chars: ${msg}`);
    }
  }

  // Polish items/locations
  if (others.length > 0) {
    try {
      const payload = {
        prompts: others.map(p => ({
          name: p.entityName, entityType: p.entityType, tier: p.tier,
          templatePrompt: p.prompt,
          description: (p as any).description || '',
          enhancedDescription: p.enhancedDescription || '',
        })),
      };
      const llmResult = await provider.chatExtract(
        POLISH_ITEM_LOCATION_PROMPT,
        `请润色以下生图提示词。每个实体的 templatePrompt 是模板生成的初版，你必须返回润色后的完整文本。

输出格式（严格遵守，不要回显输入字段）：
{
  "prompts": [
    {"name": "聚气散", "polishedPrompt": "道具设定图 —— 聚气散\\n---\\n...润色后的完整设定文本..."}
  ]
}

输入数据：
${JSON.stringify(payload, null, 2)}`,
        polishSchema
      );
      const all = [...(llmResult.prompts ?? []), ...(llmResult.items ?? []), ...(llmResult.locations ?? [])];
      let ok = 0;
      for (const entry of all) {
        const text = extractPolished(entry);
        if (text && entry.name) { result.set(entry.name, text); ok++; }
      }
      console.log(`[PromptGeneration] Item/location polish: ${ok}/${others.length} succeeded`);
    } catch (error) {
      console.warn(`[PromptGeneration] Item/location polish failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return result;
}

// ── Outfit variant expansion (non-primary outfit sets get full design-sheet prompts) ──

const POLISH_OUTFIT_PROMPT = `你是服饰套系设定图补写 agent。任务：为角色的每一套非主要服饰生成**详细、可直接生图**的四视图角色设定图提示词，让同一角色不同服饰的生成图明显不同。

核心要求：
- 每条输入的 key 唯一标识一套服饰，输出必须原样返回对应 key，不得混淆、合并或遗漏。
- 人物身份特征（面部/五官、发型、体态、神情气质、辨识度锚点）必须与 templatePrompt 保持一致——是同一个人换了衣服，不是另一个人。
- 服装/配色：围绕该套服饰的描述展开，具体到款式+颜色+材质+纹样+配饰+鞋履；不同套系之间必须有明显视觉差异。
- 保持"四视图角色设定图"结构与末尾四视图要求、风格标签（古风玄幻，精致细节，柔和光影，高质量CG）。
- 不要添加原文完全没有的角色特征。

只返回 JSON。`;

const outfitPolishSchema = z.object({
  prompts: z.array(polishEntitySchemaRaw.extend({ key: z.string().optional() })).optional().default([]),
}).passthrough();

/**
 * 为角色的非主套服饰构建完整四视图提示词，并用 LLM 补写具体细节，
 * 避免不同套系生图时提示词过于笼统导致画面无差异。
 * LLM 不可用/失败时保留模板版（仍远优于单行参考）。返回成功补写的条数。
 */
async function expandCharacterOutfitVariants(
  packByName: Map<string, any>,
  characterPrompts: GenerationPrompt[],
): Promise<number> {
  // 1. 模板：每套非主套一张完整设计图
  const pending: Array<{ key: string; entityName: string; variant: OutfitVariant }> = [];
  for (const p of characterPrompts) {
    const pack = packByName.get(p.entityName);
    if (!pack) continue;
    const outfits: Outfit[] = Array.isArray(pack.outfits) ? pack.outfits : [];
    if (outfits.length < 2) continue;
    const primary = pickPrimaryOutfit(outfits);
    const rest = outfits.filter((o) => o !== primary);
    if (rest.length === 0) continue;
    const { primary: primaryStage } = detectAgeStages(pack, pack.tier || 'candidate');
    const variants: OutfitVariant[] = [];
    rest.forEach((o, idx) => {
      const sheet = buildCharacterDesignSheet(pack, primaryStage, o);
      const variant: OutfitVariant = {
        scene: o.scene,
        description: o.description,
        prompt: sheet.prompt,
        sourceChapters: sheet.sourceChapters,
        source: 'template-only',
      };
      variants.push(variant);
      pending.push({ key: `${p.entityName}::${o.scene || o.description.slice(0, 12) || idx}`, entityName: p.entityName, variant });
    });
    p.outfitVariants = variants;
  }

  if (pending.length === 0) return 0;
  console.log(`[PromptGeneration] Outfit variants built: ${pending.length} across ${characterPrompts.filter((p) => p.outfitVariants?.length).length} characters`);
  if (!USE_LLM) return 0;

  // 2. LLM 补写（按字符数分组，控制单次上下文）
  const provider = await getDefaultProvider();
  const groups: Array<typeof pending> = [];
  let current: typeof pending = [];
  let currentChars = 0;
  for (const entry of pending) {
    const est = entry.variant.prompt.length + entry.key.length + 160;
    if (current.length > 0 && currentChars + est > MAX_CHARS) {
      groups.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(entry);
    currentChars += est;
  }
  if (current.length > 0) groups.push(current);

  let polishedCount = 0;
  for (const group of groups) {
    try {
      const payload = {
        prompts: group.map((g) => ({
          key: g.key,
          characterName: g.entityName,
          scene: g.variant.scene || '',
          outfitDescription: g.variant.description,
          templatePrompt: g.variant.prompt,
        })),
      };
      const llmResult = await provider.chatExtract(
        POLISH_OUTFIT_PROMPT,
        `请为以下服饰套系补写完整四视图提示词。每条的 templatePrompt 是模板初版，你必须返回补写后的完整文本，并原样返回 key。

输出格式（严格遵守，不要回显输入字段）：
{
  "prompts": [
    {"key": "萧炎::伪装炼药师", "polishedPrompt": "四视图角色设定图 —— 萧炎（少年·伪装炼药师服饰）\\n---\\n...补写后的完整设定文本..."}
  ]
}

输入数据：
${JSON.stringify(payload, null, 2)}`,
        outfitPolishSchema
      );
      const byKey = new Map<string, string>();
      for (const entry of llmResult.prompts ?? []) {
        const text = extractPolished(entry);
        const key = (entry as { key?: string }).key;
        if (text && key) byKey.set(key, text);
      }
      for (const g of group) {
        const text = byKey.get(g.key);
        if (text) {
          g.variant.prompt = text;
          g.variant.source = 'llm-polished';
          polishedCount++;
        } else {
          g.variant.source = 'llm-fallback';
        }
      }
    } catch (error) {
      console.warn(`[PromptGeneration] Outfit polish failed for ${group.length} outfits: ${error instanceof Error ? error.message : String(error)}`);
      for (const g of group) g.variant.source = 'llm-fallback';
    }
  }
  console.log(`[PromptGeneration] Outfit polish: ${polishedCount}/${pending.length} succeeded`);
  return polishedCount;
}

// ── Main executor ──

export async function executePromptGeneration(payload: unknown): Promise<PromptGenerationResult> {
  const source = payload as PromptGenerationPayload;
  const characterPacks = source.characterVisualDescriptions || [];
  const locationPacks = source.locationVisualDescriptions || [];
  const itemPacks = source.itemVisualDescriptions || [];

  // Build name→tier map from entity arrays (tier lives on entities, not on description packs)
  const tierMap = new Map<string, string>();
  for (const entity of source.characters || []) {
    if (entity.name) tierMap.set(entity.name, (entity as any).tier || 'candidate');
  }
  for (const entity of source.items || []) {
    if (entity.name) tierMap.set(entity.name, (entity as any).tier || 'candidate');
  }
  for (const entity of source.locations || []) {
    if (entity.name) tierMap.set(entity.name, (entity as any).tier || 'candidate');
  }

  // Build template prompts
  const resolveTier = (name: string): string => tierMap.get(name) || 'candidate';
  // Build description map from entities for age/identity hints
  const descMap = new Map<string, string>();
  for (const entity of [...(source.characters || []), ...(source.items || []), ...(source.locations || [])]) {
    if (entity.name && (entity as any).description) descMap.set(entity.name, (entity as any).description);
  }

  // Build name→outfits map from characters (structured outfits captured at extraction)
  const outfitMap = new Map<string, Outfit[]>();
  for (const entity of source.characters || []) {
    if (entity.name && Array.isArray((entity as any).outfits)) outfitMap.set(entity.name, (entity as any).outfits);
  }

  // 完整 pack 缓存（服饰套系补写需要 visualFields/outfits 等全量字段）
  const packByName = new Map<string, any>();

  // Build name→owners map from items (structured ownership captured at extraction)
  const ownerMap = new Map<string, Owner[]>();
  for (const entity of source.items || []) {
    if (entity.name && Array.isArray((entity as any).owners)) ownerMap.set(entity.name, (entity as any).owners);
  }

  // Build mentionCount / importanceScore maps so LLM polish can trigger for major characters
  // even when tier is lost through the pipeline.
  const mentionMap = new Map<string, number>();
  const importanceMap = new Map<string, number>();
  for (const entity of source.characters || []) {
    if (entity.name) {
      mentionMap.set(entity.name, (entity as any).mentionCount ?? 0);
      importanceMap.set(entity.name, (entity as any).importanceScore ?? 0);
    }
  }

  let characterPrompts = characterPacks.map(p => {
    // outfits 优先取 visual pack（prescan/视觉链路的原始证据）；入库的 character 实体
    // 不持久化 outfits，仅在中间 payload 携带，只作回退来源。
    const packOutfits = Array.isArray((p as any).outfits) && ((p as any).outfits as Outfit[]).length > 0
      ? ((p as any).outfits as Outfit[])
      : outfitMap.get(p.name) || [];
    const input = {
      ...p,
      tier: resolveTier(p.name),
      description: descMap.get(p.name) || '',
      outfits: packOutfits,
      mentionCount: mentionMap.get(p.name) ?? 0,
      importanceScore: importanceMap.get(p.name) ?? 0,
    };
    // 保留完整 pack，供服饰套系补写时读取 visualFields/outfits
    packByName.set(p.name, input);
    return buildCharacterPrompt(input as any);
  });
  let locationPrompts = locationPacks.map(p => buildLocationPrompt({ ...p, tier: resolveTier(p.name) } as any));
  let itemPrompts = itemPacks.map(p => buildItemPrompt({ ...p, tier: resolveTier(p.name), owners: ownerMap.get(p.name) || [] } as any));

  // LLM polish
  const charMentionMap = new Map<string, number>();
  const charImportanceMap = new Map<string, number>();
  for (const entity of source.characters || []) {
    if (entity.name) {
      charMentionMap.set(entity.name, (entity as any).mentionCount ?? 0);
      charImportanceMap.set(entity.name, (entity as any).importanceScore ?? 0);
    }
  }
  const llmTargets = [
    ...characterPrompts.filter((p) =>
      needsLlmPolish(p.tier, charMentionMap.get(p.entityName), charImportanceMap.get(p.entityName))
      || needsPolishForUnset(p.prompt, Boolean(descMap.get(p.entityName)), Boolean(p.enhancedDescription))
    ),
    ...locationPrompts.filter((p) =>
      needsLlmPolish(p.tier)
      || needsPolishForUnset(p.prompt, Boolean(descMap.get(p.entityName)), Boolean(p.enhancedDescription))
    ),
    ...itemPrompts.filter((p) =>
      needsLlmPolish(p.tier)
      || needsPolishForUnset(p.prompt, Boolean(descMap.get(p.entityName)), Boolean(p.enhancedDescription))
    ),
  ];

  let llmPolished = 0;
  let llmFallback = 0;

  if (llmTargets.length > 0) {
    console.log(`[PromptGeneration] Polishing ${llmTargets.length} prompts with LLM`);

    const groups: GenerationPrompt[][] = [];
    let current: GenerationPrompt[] = [];
    let currentChars = 0;

    for (const p of llmTargets) {
      const est = p.prompt.length + p.entityName.length + 120;
      if (current.length > 0 && currentChars + est > MAX_CHARS) {
        groups.push(current);
        current = [];
        currentChars = 0;
      }
      current.push(p);
      currentChars += est;
    }
    if (current.length > 0) groups.push(current);

    for (const group of groups) {
      const polished = await polishWithLlm(group);
      for (const p of group) {
        const newPrompt = polished.get(p.entityName);
        if (newPrompt) {
          p.prompt = newPrompt;
          p.source = 'llm-polished';
          // 回写主 variant，保持顶层 prompt 与主阶段 variant 一致
          if (Array.isArray(p.variants)) {
            const pv = p.variants.find((v) => v.isPrimary);
            if (pv) { pv.prompt = newPrompt; pv.source = 'llm-polished'; }
          }
          llmPolished++;
        } else {
          p.source = 'llm-fallback';
          llmFallback++;
        }
      }
    }
  }

  const templateOnly =
    characterPrompts.filter((p) => p.source === 'template-only').length +
    locationPrompts.filter((p) => p.source === 'template-only').length +
    itemPrompts.filter((p) => p.source === 'template-only').length;

  // 服饰套系补写：为非主套服饰构建完整四视图提示词并 LLM 补写细节，
  // 避免"其余服饰套系"只有一行参考导致不同服饰生图无差异。
  let outfitPolished = 0;
  try {
    outfitPolished = await expandCharacterOutfitVariants(packByName, characterPrompts);
  } catch (err) {
    console.warn(`[PromptGeneration] Outfit expansion failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  console.log(
    `[PromptGeneration] Generated ${characterPrompts.length + locationPrompts.length + itemPrompts.length} prompts (llm-polished=${llmPolished}, template-only=${templateOnly}, llm-fallback=${llmFallback}, outfit-polished=${outfitPolished})`
  );

  // 最终剥离：章节标注（第x章）是溯源元数据，只在中间链路中传递，
  // 不应进入生图 prompt（会浪费 token、引入非视觉噪声）。
  // 必须在 LLM 润色之后执行——LLM 需要章节上下文才能保留出处，但最终 prompt 必须干净。
  for (const p of characterPrompts) {
    p.prompt = stripChapterRef(p.prompt);
    if (Array.isArray(p.variants)) {
      for (const v of p.variants) v.prompt = stripChapterRef(v.prompt);
    }
    if (Array.isArray(p.outfitVariants)) {
      for (const v of p.outfitVariants) v.prompt = stripChapterRef(v.prompt);
    }
  }
  for (const p of locationPrompts) p.prompt = stripChapterRef(p.prompt);
  for (const p of itemPrompts) p.prompt = stripChapterRef(p.prompt);

  return {
    ...source,
    characters: source.characters || [],
    locations: source.locations || [],
    items: source.items || [],
    characterPrompts,
    locationPrompts,
    itemPrompts,
    promptGeneration: {
      total: characterPrompts.length + locationPrompts.length + itemPrompts.length,
      llmPolished,
      templateOnly,
      llmFallback,
    },
  };
}
