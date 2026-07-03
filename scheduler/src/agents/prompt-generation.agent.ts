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

export interface GenerationPrompt {
  entityName: string;
  entityType: 'character' | 'item' | 'location';
  tier: string;
  prompt: string;
  styleTags: string[];
  source: 'template-only' | 'llm-polished' | 'llm-fallback';
  quality: 'high' | 'medium' | 'low';
  description?: string;
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

function buildCharacterDesignSheet(pack: any): GenerationPrompt {
  const tier = pack.tier || 'candidate';
  const vf = pack.visualFields || {};
  const vd = pack.visualDetails || {};
  const desc = pack.description || '';

  // Extract structured fields from visual-description data
  const body = pickOne(vd, vf, 'bodyBuild', 'body') || '未详述';
  const face = pickOne(vd, vf, 'faceShape', 'appearance') || '未详述';
  const hair = pickOne(vd, vf, 'hair') || '未详述';
  const eyes = pickOne(vd, vf, 'eyes') || '未详述';
  const nose = pickOne(vd, vf, 'nose') || '未详述';
  const lips = pickOne(vd, vf, 'lips') || '未详述';
  const skin = pickOne(vd, vf, 'skin') || '未详述';
  const temperament = pickOne(vd, vf, 'temperament') || '未详述';
  const makeup = pickOne(vd, vf, 'makeupStyling') || '未详述';
  // Prefer structured primary outfit (captured at extraction with chapter range);
  // fall back to the regex clothing field if no outfits are available.
  const outfits: Outfit[] = Array.isArray(pack.outfits) ? pack.outfits : [];
  const primaryOutfit = pickPrimaryOutfit(outfits);
  const clothing = primaryOutfit?.description || pickOne(vd, vf, 'clothing') || '未详述';
  const items = cleanVisualField(vf.signatureItems || '') || '无';
  const ageHint = buildAgeHint(tier, desc);

  // Age/identity: from description and tier
  const sections = [
    `- 服装/配色：${clothing}`,
    `- 面部/五官：${[face, eyes, nose, lips, skin].filter(s => s !== '未详述').join('，')}`,
    `- 发型：${hair}`,
    `- 体态/身形：${body}`,
    `- 神情/气质：${temperament}`,
    `- 饰物/随身特征：${items}`,
    `- 年龄/身份视觉线索：${ageHint}`,
  ];

  const template = [
    `四视图角色设定图 —— ${pack.name}`,
    '---',
    '角色设定拆解',
    ...sections,
    '---',
    '四视图要求：同一人物，正面全身、侧面全身、背面全身、面部特写。服装、体型、发型、饰物四个角度保持一致。' + CHARACTER_STYLE_TAGS.join('，') + '。',
    ...renderOutfitList(outfits, primaryOutfit),
  ].join('\n');

  const needsPolish = needsLlmPolish(tier);

  return {
    entityName: pack.name,
    entityType: 'character',
    tier,
    prompt: template,
    styleTags: CHARACTER_STYLE_TAGS,
    source: needsPolish ? 'llm-polished' : 'template-only',
    quality: needsPolish ? 'high' : 'medium',
    description: pack.description || (pack as any).currentDescription || '',
  } as GenerationPrompt;
}

function pickOne(vd: any, vf: any, ...keys: string[]): string {
  for (const k of keys) {
    const v = ((vd[k] || vf[k] || '').trim());
    if (v && v.length > 1) return cleanVisualField(v);
  }
  return '';
}

function buildAgeHint(tier: string, description: string): string {
  // Extract age-related signals from description
  const ageMatch = description.match(/(\d{1,3})\s*(岁|年龄)/);
  if (ageMatch) return `${ageMatch[0]}`;
  const youthWords: [string, string][] = [
    ['少年', '少年（约14-16岁）'], ['少女', '少女（约14-16岁）'],
    ['青年', '青年（约20-30岁）'], ['中年', '中年'],
    ['老年', '老年'], ['孩童', '孩童'], ['幼年', '幼年'],
    ['年轻', '年轻'], ['年幼', '年幼'], ['年老', '年老'],
  ];
  for (const [w, hint] of youthWords) {
    if (description.includes(w)) return hint;
  }
  if (tier === 'core') return '少年/青年（主角）';
  if (tier === 'supporting') return '中青年';
  return '不详';
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

function needsLlmPolish(tier?: string): boolean {
  if (!USE_LLM) return false;
  if (!tier) return false;
  return (TIER_ORDER[tier] ?? 99) <= (TIER_ORDER[LLM_MIN_TIER] ?? 99);
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
  return buildCharacterDesignSheet(pack);
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
  } as GenerationPrompt;
}

// ── LLM polish ──

const POLISH_CHARACTER_PROMPT = `你是角色设定图润色 agent。任务：将模板生成的四视图角色设定图优化为可直接用于 AI 生图的专业提示词。

规则：
- 保持”四视图角色设定图 —— 角色名”的结构格式不变
- 保持”角色设定拆解”的逐项字段
- 主要人物（tier=core/supporting）：补充未详述字段，根据已有设定做保守合理推断。优先从 description 提取年龄/身份/服装线索
- 次要人物（tier=candidate/archived）：精简冗余描述，移除那些与主视觉无关的叙述。未详述的字段可保留”未详述”或删除整行
- 四视图要求末尾加入：古风玄幻，精致细节，柔和光影，高质量CG
- 同一人物在四个视图中服装、体型、发型、饰物保持一致
- 不添加原文没有的角色特征

只返回 JSON。`;

const POLISH_ITEM_LOCATION_PROMPT = `你是生图提示词润色 agent。任务：将模板生成的"场景设定图/道具设定图"优化为可直接用于 AI 生图的专业提示词。

规则：
- 保持"场景设定图/道具设定图 —— 名称"的结构格式不变
- 保持"设定拆解"的逐项字段；未详述的字段可做保守视觉补全或删除整行
- 主要实体（core/supporting）：补全缺失字段的保守视觉推断，强化最具辨识度的视觉特征
- 次要实体：精简冗余，移除与主视觉无关的叙述
- 末尾"全景要求/展示要求/分镜要求"行保留构图、风格标签与九宫格分镜指令
- 严格只保留视觉相关内容，不添加原文没有的设定
- 道具的"归属者"行仅作设定参考，不要写进画面（除非该持有者本就要入画）

只返回 JSON。`;

// chatExtract 返回结构：每条实体对应一个 polishedPrompt。所有调用点都在 try/catch 内，
// 解析失败会降级为跳过润色，因此宽松定义即可。
const polishSchema = z.object({
  prompts: z.array(
    z.object({
      name: z.string(),
      polishedPrompt: z.string(),
    }),
  ),
});

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
        })),
      };
      const llmResult = await provider.chatExtract(
        POLISH_CHARACTER_PROMPT,
        `请润色以下角色设定图：\n${JSON.stringify(payload, null, 2)}`,
        polishSchema
      );
      for (const entry of llmResult.prompts ?? []) {
        if (entry.polishedPrompt) result.set(entry.name, entry.polishedPrompt);
      }
    } catch (error) {
      console.warn(`[PromptGeneration] Character polish failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Polish items/locations
  if (others.length > 0) {
    try {
      const payload = {
        prompts: others.map(p => ({
          name: p.entityName, entityType: p.entityType, tier: p.tier,
          templatePrompt: p.prompt,
        })),
      };
      const llmResult = await provider.chatExtract(
        POLISH_ITEM_LOCATION_PROMPT,
        `请润色以下生图提示词：\n${JSON.stringify(payload, null, 2)}`,
        polishSchema
      );
      for (const entry of llmResult.prompts ?? []) {
        if (entry.polishedPrompt) result.set(entry.name, entry.polishedPrompt);
      }
    } catch (error) {
      console.warn(`[PromptGeneration] Item/location polish failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return result;
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

  // Build name→owners map from items (structured ownership captured at extraction)
  const ownerMap = new Map<string, Owner[]>();
  for (const entity of source.items || []) {
    if (entity.name && Array.isArray((entity as any).owners)) ownerMap.set(entity.name, (entity as any).owners);
  }

  let characterPrompts = characterPacks.map(p => buildCharacterPrompt({ ...p, tier: resolveTier(p.name), description: descMap.get(p.name) || '', outfits: outfitMap.get(p.name) || [] } as any));
  let locationPrompts = locationPacks.map(p => buildLocationPrompt({ ...p, tier: resolveTier(p.name) } as any));
  let itemPrompts = itemPacks.map(p => buildItemPrompt({ ...p, tier: resolveTier(p.name), owners: ownerMap.get(p.name) || [] } as any));

  // LLM polish
  const llmTargets = [
    ...characterPrompts.filter((p) => needsLlmPolish(p.tier)),
    ...locationPrompts.filter((p) => needsLlmPolish(p.tier)),
    ...itemPrompts.filter((p) => needsLlmPolish(p.tier)),
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

  console.log(
    `[PromptGeneration] Generated ${characterPrompts.length + locationPrompts.length + itemPrompts.length} prompts (llm-polished=${llmPolished}, template-only=${templateOnly}, llm-fallback=${llmFallback})`
  );

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
