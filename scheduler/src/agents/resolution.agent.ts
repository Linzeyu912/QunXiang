import type { AgentType, Character, Location, Item } from '@qunxiang/core';
import { mergeEntityDescriptions } from '@qunxiang/core';
import { resolve, isKinshipEquivalentName, isKinshipName, kinshipNormalize } from '@qunxiang/entity-resolution';
import { getDefaultProvider } from '@qunxiang/llm';
import { z } from 'zod';
import type { CharacterDescriptionPack, ItemDescriptionPack, LocationDescriptionPack } from './entity-descriptions.js';

export const resolutionAgentType: AgentType = 'entity-resolution';

export interface ResolutionPayload {
  characters: Omit<Character, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>[];
  locations?: Omit<Location, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>[];
  items?: Omit<Item, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>[];
  characterDescriptions?: CharacterDescriptionPack[];
  itemDescriptions?: ItemDescriptionPack[];
  locationDescriptions?: LocationDescriptionPack[];
}

export interface ResolutionResult {
  characters: Omit<Character, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>[];
  merged: number;
  locations: Omit<Location, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>[];
  items: Omit<Item, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>[];
  characterDescriptions?: CharacterDescriptionPack[];
  itemDescriptions?: ItemDescriptionPack[];
  locationDescriptions?: LocationDescriptionPack[];
  /** LLM 融合层执行情况（模型不可用时缺省，管道继续走规则层结果） */
  llmFusion?: {
    judged: number;
    merged: number;
    /** 经 LLM 重新分类的道具数（原先落在 other） */
    classified?: number;
    message?: string;
  };
}

type PipelineCharacter = ResolutionPayload['characters'][number];
type PipelineLocation = NonNullable<ResolutionPayload['locations']>[number];
type PipelineItem = NonNullable<ResolutionPayload['items']>[number];

// ─── LLM 融合层（整单分组消歧，覆盖角色/场景/道具） ───
//
// 规则层（resolve + 提取期精确同名折叠）只做无损预处理；语义级的"这两行
// 是不是同一个实体"全部交给 LLM：把整份实体清单一次性发给模型，返回
// "同一实体"的编号分组。置信度达标的分组自动合并（提及数多者为主），
// 未达标的只记日志、保持独立，落库后仍可由审核页人工处理。
// 另附道具分类补救：关键词推断后仍落在 other 的道具，批量交 LLM 归类。

/** 单次调用的实体清单上限（控制上下文体积；超出的书分批，批间重复靠人工兜底） */
const FUSION_CHUNK_SIZE = 60;

/** 描述摘要长度上限 */
const FUSION_DESC_LIMIT = 120;

/** 自动合并阈值：分组置信度不低于该值才执行合并 */
const AUTO_MERGE_CONFIDENCE = 0.8;

const fusionGroupSchema = z.object({
  indices: z.array(z.number().int().min(0)),
  confidence: z.number().min(0).max(1),
  reason: z.string().optional(),
});

const fusionResultSchema = z.object({
  groups: z.array(fusionGroupSchema).default([]),
});

const FUSION_SYSTEM_PROMPT = [
  '你是小说实体消歧助手。下面是一本书提取出的实体清单，每行带编号。',
  '请找出【指同一个实体】的行，以编号分组返回。',
  '判断要点：',
  '1. 称谓变体（如"萧炎"与"萧炎哥"、"古德里安"与"古德里安教授"、"薰儿"与"萧薰儿"、"乌坦城"与"乌坦城大厅"）通常是同一实体。',
  '2. 亲属称谓变体（如"路明非的妈妈"与"路明非的母亲"）是同一角色。',
  '3. 但"X的父亲"与"X的母亲"是两个不同的人，绝不能合并；"小/老/大"前缀可能是幼体或另一独立个体，描述冲突时倾向不合并。',
  '4. 两个实体的描述若指向明显不同的身份、地点性质或物品来历，是不同实体，即使名字相似。',
  '5. 只分组有把握的；拿不准就整组不返回，不要猜测。',
  '只返回 JSON，格式：{"groups":[{"indices":[编号,编号],"confidence":0.0-1.0,"reason":"简短中文理由"}]}',
  '没有重复实体时返回 {"groups":[]}。indices 只能使用清单中存在的编号。',
].join('\n');

/** 道具 LLM 分类补救：关键词判不出的 other 道具批量归类 */
const ITEM_CATEGORY_VALUES = ['weapon', 'skill', 'food', 'pill', 'treasure', 'electronics', 'document', 'other'] as const;

const itemClassifySchema = z.object({
  items: z.array(z.object({
    index: z.number().int().min(0),
    category: z.enum(ITEM_CATEGORY_VALUES),
  })).default([]),
});

const ITEM_CLASSIFY_SYSTEM_PROMPT = [
  '你是小说道具分类助手。下面是提取出但未能自动归类的道具清单，每行带编号。',
  '请根据名称与描述为每个道具选择最贴切的大类：',
  '- weapon 武器：刀剑枪棍等战斗兵器',
  '- skill 技能功法：可学习施展的功法招式',
  '- food 食物：可食用之物',
  '- pill 丹药消耗品：丹药、灵草、药剂',
  '- treasure 法宝器物：贵重器物、信物、奇物',
  '- electronics 电子设备：手机、电脑、相机等电子产品',
  '- document 文件信物：信件、证件、照片、文件、书籍报刊',
  '- other 其他：以上都不适用',
  '只返回 JSON：{"items":[{"index":编号,"category":"大类"}]}，为每个编号给出归类。',
].join('\n');

/** 同人前缀但不同亲属（如"X的父亲"vs"X的母亲"）→ 两个人，整组拒绝合并 */
function isKinshipConflict(a: string, b: string): boolean {
  if (!isKinshipName(a) || !isKinshipName(b)) return false;
  if (isKinshipEquivalentName(a, b)) return false;
  const ka = kinshipNormalize(a);
  const kb = kinshipNormalize(b);
  const ia = ka.lastIndexOf('的');
  const ib = kb.lastIndexOf('的');
  if (ia <= 0 || ib <= 0) return false;
  return ka.slice(0, ia) === kb.slice(0, ib) && ka.slice(ia + 1) !== kb.slice(ib + 1);
}

/** 融合共通字段：以提及数多者为主，别名并入、章节并集、计数求和、描述拼接 */
function fuseMergeCommon<T extends {
  name: string;
  aliases?: string[];
  description?: string;
  confidence?: number;
  chapterAppearances?: number[];
  mentionCount?: number;
  firstChapter?: number;
  lastChapter?: number;
}>(primary: T, secondary: T): T {
  const chapters = [...new Set([...(primary.chapterAppearances || []), ...(secondary.chapterAppearances || [])])].sort((a, b) => a - b);
  const aliases = [...new Set([...(primary.aliases || []), ...(secondary.aliases || []), secondary.name])]
    .filter((alias) => alias !== primary.name);
  return {
    ...primary,
    aliases,
    description: mergeEntityDescriptions(primary.description, secondary.description),
    confidence: Math.max(primary.confidence ?? 0, secondary.confidence ?? 0),
    firstChapter: chapters.length > 0 ? chapters[0] : primary.firstChapter,
    lastChapter: chapters.length > 0 ? chapters[chapters.length - 1] : primary.lastChapter,
    chapterAppearances: chapters,
    mentionCount: (primary.mentionCount || 0) + (secondary.mentionCount || 0),
  };
}

function fuseMergeCharacters(primary: PipelineCharacter, secondary: PipelineCharacter): PipelineCharacter {
  const merged = fuseMergeCommon(primary, secondary);
  return {
    ...merged,
    dialogueCount: Math.max(primary.dialogueCount || 0, secondary.dialogueCount || 0),
    coCharacters: [...new Set([...(primary.coCharacters || []), ...(secondary.coCharacters || [])])],
  };
}

function summarizeForPrompt(entity: { name: string; aliases?: string[]; description?: string; mentionCount?: number }, index: number): string {
  const aliases = (entity.aliases || []).slice(0, 8).join('、');
  const description = (entity.description || '无').slice(0, FUSION_DESC_LIMIT);
  return `${index}. 名称：${entity.name}｜别名：${aliases || '无'}｜提及：${entity.mentionCount || 0}｜描述：${description}`;
}

/** LLM 整单分组消歧（泛型，角色/场景/道具通用）。模型不可用或调用失败时
 *  原样返回（融合是增强步骤，绝不允许它阻断管道）。 */
async function llmFuseEntities<T extends {
  name: string;
  aliases?: string[];
  description?: string;
  confidence?: number;
  chapterAppearances?: number[];
  mentionCount?: number;
}>(
  entities: T[],
  options: { kindLabel: string; kinshipGuard?: boolean; merge?: (a: T, b: T) => T },
): Promise<{ entities: T[]; judged: number; merged: number; message?: string }> {
  if (entities.length < 2) {
    return { entities, judged: 0, merged: 0 };
  }
  let provider: Awaited<ReturnType<typeof getDefaultProvider>>;
  try {
    provider = await getDefaultProvider();
    if (!(await provider.isConfigured())) {
      return { entities, judged: 0, merged: 0, message: '模型服务未配置，跳过 LLM 融合' };
    }
  } catch {
    return { entities, judged: 0, merged: 0, message: '模型服务不可用，跳过 LLM 融合' };
  }

  const mergeFn = options.merge ?? ((a: T, b: T) => fuseMergeCommon(a, b));

  // 并查集：跨分组合并同一实体
  const parent = entities.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  let judged = 0;
  let mergeUnions = 0;

  for (let start = 0; start < entities.length; start += FUSION_CHUNK_SIZE) {
    const chunk = entities.slice(start, start + FUSION_CHUNK_SIZE);
    const roster = chunk.map((e, i) => summarizeForPrompt(e, i)).join('\n');
    let parsed: z.infer<typeof fusionResultSchema>;
    try {
      // chatExtract 的泛型按输入类型推断（.default 使 groups 可选），这里再过一次
      // schema.parse 把类型归一到输出形态（运行时幂等）
      const raw: unknown = await provider.chatExtract(FUSION_SYSTEM_PROMPT, `${options.kindLabel}清单：\n${roster}`, fusionResultSchema);
      parsed = fusionResultSchema.parse(raw);
    } catch (error) {
      console.warn(`[Resolution] ${options.kindLabel}融合分组调用失败（第 ${Math.floor(start / FUSION_CHUNK_SIZE) + 1} 批）：${error instanceof Error ? error.message : error}`);
      continue;
    }
    judged += chunk.length;

    for (const group of parsed.groups) {
      const indices = [...new Set(group.indices)].filter((i) => i >= 0 && i < chunk.length);
      if (indices.length < 2) continue;

      const names = indices.map((i) => chunk[i].name);
      if (options.kinshipGuard) {
        const hasConflict = names.some((a) => names.some((b) => a !== b && isKinshipConflict(a, b)));
        if (hasConflict) {
          console.warn(`[Resolution] 拒绝分组 [${names.join('、')}]：组内包含互相冲突的亲属称谓（不同的人）`);
          continue;
        }
      }

      if (group.confidence >= AUTO_MERGE_CONFIDENCE) {
        for (let k = 1; k < indices.length; k++) {
          if (find(indices[0]) !== find(indices[k])) {
            union(indices[0], indices[k]);
            mergeUnions++;
          }
        }
        console.log(`[Resolution] ${options.kindLabel}融合分组 [${names.join('、')}]（${group.confidence}${group.reason ? `：${group.reason}` : ''}）`);
      } else {
        console.log(`[Resolution] ${options.kindLabel}低置信分组保持独立 [${names.join('、')}]（${group.confidence}）`);
      }
    }
  }

  if (mergeUnions === 0) {
    return { entities, judged, merged: 0 };
  }

  // 按并查集分量折叠：每个分量以提及数最多者为主实体
  const groupsByRoot = new Map<number, number[]>();
  for (let i = 0; i < entities.length; i++) {
    const root = find(i);
    if (!groupsByRoot.has(root)) groupsByRoot.set(root, []);
    groupsByRoot.get(root)!.push(i);
  }

  const fused: T[] = [];
  for (const members of groupsByRoot.values()) {
    if (members.length === 1) {
      fused.push(entities[members[0]]);
      continue;
    }
    const ordered = [...members].sort((a, b) => (entities[b].mentionCount || 0) - (entities[a].mentionCount || 0));
    let mergedEntity = entities[ordered[0]];
    for (let k = 1; k < ordered.length; k++) {
      mergedEntity = mergeFn(mergedEntity, entities[ordered[k]]);
    }
    fused.push(mergedEntity);
  }

  return { entities: fused, judged, merged: mergeUnions };
}

/** 道具分类补救：批量把 other 道具交 LLM 归类（失败静默跳过）。 */
async function llmClassifyItems(items: PipelineItem[]): Promise<{ items: PipelineItem[]; classified: number }> {
  const pending = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => !item.category || item.category === 'other');
  if (pending.length === 0) return { items, classified: 0 };

  let provider: Awaited<ReturnType<typeof getDefaultProvider>>;
  try {
    provider = await getDefaultProvider();
    if (!(await provider.isConfigured())) return { items, classified: 0 };
  } catch {
    return { items, classified: 0 };
  }

  const next = [...items];
  let classified = 0;
  for (let start = 0; start < pending.length; start += FUSION_CHUNK_SIZE) {
    const chunk = pending.slice(start, start + FUSION_CHUNK_SIZE);
    const roster = chunk.map(({ item }, i) => {
      const description = (item.description || '无').slice(0, FUSION_DESC_LIMIT);
      return `${i}. 名称：${item.name}｜描述：${description}`;
    }).join('\n');
    try {
      const raw: unknown = await provider.chatExtract(ITEM_CLASSIFY_SYSTEM_PROMPT, `道具清单：\n${roster}`, itemClassifySchema);
      const parsed = itemClassifySchema.parse(raw);
      for (const entry of parsed.items) {
        if (entry.index < 0 || entry.index >= chunk.length) continue;
        if (entry.category === 'other') continue;
        const target = chunk[entry.index];
        next[target.index] = { ...target.item, category: entry.category };
        classified++;
        console.log(`[Resolution] 道具分类《${target.item.name}》→ ${entry.category}`);
      }
    } catch (error) {
      console.warn(`[Resolution] 道具分类调用失败：${error instanceof Error ? error.message : error}`);
    }
  }
  return { items: next, classified };
}

export async function executeResolution(payload: unknown): Promise<ResolutionResult> {
  const { characters, locations = [], items = [], characterDescriptions, itemDescriptions, locationDescriptions } = payload as ResolutionPayload;

  const result = resolve(characters);

  // LLM 融合层：规则合并后对三类实体做整单语义消歧 + 道具分类补救（增强步骤，失败不阻断）
  let fusedCharacters = result.characters;
  let fusedLocations = locations;
  let fusedItems = items;
  let classified = 0;
  const messages: string[] = [];
  let judged = 0;
  let merged = 0;
  try {
    const charFusion = await llmFuseEntities(fusedCharacters, {
      kindLabel: '角色',
      kinshipGuard: true,
      merge: fuseMergeCharacters,
    });
    fusedCharacters = charFusion.entities;
    judged += charFusion.judged;
    merged += charFusion.merged;
    if (charFusion.message) messages.push(charFusion.message);

    const locFusion = await llmFuseEntities(fusedLocations, { kindLabel: '场景' });
    fusedLocations = locFusion.entities;
    judged += locFusion.judged;
    merged += locFusion.merged;
    if (locFusion.message) messages.push(locFusion.message);

    const itemFusion = await llmFuseEntities(fusedItems, { kindLabel: '道具' });
    fusedItems = itemFusion.entities;
    judged += itemFusion.judged;
    merged += itemFusion.merged;
    if (itemFusion.message) messages.push(itemFusion.message);

    const classifyResult = await llmClassifyItems(fusedItems);
    fusedItems = classifyResult.items;
    classified = classifyResult.classified;
  } catch (error) {
    messages.push(`LLM 融合层异常：${error instanceof Error ? error.message : error}`);
  }
  if (merged > 0 || classified > 0) {
    console.log(`[Resolution] LLM 融合层：消歧 ${judged} 个实体，自动合并 ${merged} 组，道具分类 ${classified} 个`);
  }

  return {
    characters: fusedCharacters,
    merged: result.merged,
    locations: fusedLocations,
    items: fusedItems,
    characterDescriptions,
    itemDescriptions,
    locationDescriptions,
    llmFusion: {
      judged,
      merged,
      ...(classified > 0 ? { classified } : {}),
      ...(messages.length > 0 ? { message: messages.join('；') } : {}),
    },
  };
}
