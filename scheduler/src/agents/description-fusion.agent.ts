import type { AgentType, Character, Item, Location } from '@novel-agent/core';
import { cleanEntityDescription, mergeEntityDescriptions } from '@novel-agent/core';
import { resolve } from '@novel-agent/entity-resolution';
import { deduplicateEntities } from './entity-dedupe.js';
import { getDefaultProvider } from '@novel-agent/llm';
import { z } from 'zod';
import type { CharacterDescriptionPack, ItemDescriptionPack, LocationDescriptionPack } from './entity-descriptions.js';

export const descriptionFusionAgentType: AgentType = 'description-fusion';

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

export interface DescriptionFusionPayload extends Record<string, unknown> {
  characters: CharacterEntity[];
  locations?: LocationEntity[];
  items?: ItemEntity[];
  characterDescriptions?: CharacterDescriptionPack[];
  itemDescriptions?: ItemDescriptionPack[];
  locationDescriptions?: LocationDescriptionPack[];
}

export interface DescriptionFusionResult extends DescriptionFusionPayload {
  characters: CharacterEntity[];
  locations: LocationEntity[];
  items: ItemEntity[];
  descriptionFusion: {
    requested: number;
    fused: number;
    skipped: number;
  };
}

const fusedEntitySchema = z.object({
  name: z.string(),
  description: z.string().optional().default(''),
});

const fusionSchema = z.object({
  characters: z.array(fusedEntitySchema).optional().default([]),
  items: z.array(fusedEntitySchema).optional().default([]),
  locations: z.array(fusedEntitySchema).optional().default([]),
});

const DESCRIPTION_FUSION_SYSTEM_PROMPT = `你是小说实体简介融合 agent。

你的任务：根据原文概括得到的批次简介，融合每个实体的简介。

必须遵守：
- 根据原文概括，只能使用输入里已经给出的简介片段和证据线索，不要乱补新设定。
- 不要省略关键身份、关系、能力、动机、重要经历、外貌气质等已出现信息。
- 删除重复表达，把多个批次的“主角，萧家三少爷；萧家三少爷……”融合成一段自然简介。
- 输出完整句或完整短语，不能以半截句、连接词、数字残片结尾。
- 如果信息互补，合并保留；如果信息冲突，采用更具体、更有上下文的一版，并避免武断扩写。
- 不要把亲属、下属、宗门或家族的行为转移给实体本人；如果输入写的是"其女/其子/族人/弟子"，输出也必须保留真实动作主体。
- 次要实体可以短一些，但不能丢掉输入中唯一的关键信息。

只返回 JSON：
{
  "characters": [{"name": "实体名", "description": "融合后的简介"}],
  "items": [{"name": "实体名", "description": "融合后的简介"}],
  "locations": [{"name": "实体名", "description": "融合后的简介"}]
}`;

interface FusionInputEntity {
  kind: EntityKind;
  name: string;
  aliases: string[];
  currentDescription: string;
}

function splitDescription(description: string | null | undefined): string[] {
  if (!description) return [];
  return description
    .split(/[;；\n]+/)
    .map((part) => cleanEntityDescription(part))
    .filter((part): part is string => Boolean(part));
}

function hasRepeatedFragments(fragments: string[]): boolean {
  const normalized = fragments.map((fragment) => fragment.replace(/\s+/g, ''));
  return new Set(normalized).size < normalized.length;
}

function shouldFuseDescription(description: string | null | undefined): boolean {
  const clean = cleanEntityDescription(description);
  if (!clean) return false;
  const fragments = splitDescription(clean);
  return fragments.length > 1 || clean.length > 220 || hasRepeatedFragments(fragments);
}

function normalizeEntityDescription(description: string | null | undefined): string | undefined {
  const fragments = splitDescription(description);
  if (fragments.length === 0) return cleanEntityDescription(description);
  return mergeEntityDescriptions(...removeRepeatedIntroLabels(fragments));
}

function normalizeName(value: string): string {
  return cleanEntityDescription(value)?.toLocaleLowerCase() || '';
}

function removeRepeatedIntroLabels(fragments: string[]): string[] {
  const seenLabels = new Set<string>();
  return fragments
    .map((fragment) => {
      const match = fragment.match(/^((?:本书|小说)?主角)[，,、:：]\s*/u);
      if (!match) return fragment;

      const label = '主角';
      if (seenLabels.has(label)) {
        return fragment.slice(match[0].length).trim();
      }
      seenLabels.add(label);
      return fragment.replace(match[0], `${label}，`).trim();
    })
    .filter(Boolean);
}

function normalizeAliasKey(value: string): string {
  return normalizeName(value).replace(/薰/g, '熏');
}

function sanitizeEntityAliases<T extends { name: string; aliases?: string[] }>(entities: T[]): T[] {
  const primaryNames = new Set(entities.map((entity) => normalizeAliasKey(entity.name)));
  return entities.map((entity) => {
    const aliases = [...new Set(entity.aliases || [])].filter((alias) => {
      const cleanAlias = cleanEntityDescription(alias);
      if (!cleanAlias || cleanAlias.length < 2 || GENERIC_ALIASES.has(cleanAlias)) return false;
      const normalizedAlias = normalizeAliasKey(cleanAlias);
      return normalizedAlias !== normalizeAliasKey(entity.name) && !primaryNames.has(normalizedAlias);
    });
    return { ...entity, aliases };
  });
}

function collectFusionInputs<T extends { name: string; aliases?: string[]; description?: string }>(
  kind: EntityKind,
  entities: T[]
): FusionInputEntity[] {
  return entities
    .filter((entity) => shouldFuseDescription(entity.description))
    .map((entity) => ({
      kind,
      name: entity.name,
      aliases: entity.aliases || [],
      currentDescription: normalizeEntityDescription(entity.description) || '',
    }))
    .filter((entity) => entity.currentDescription);
}

function groupInputs(inputs: FusionInputEntity[]): FusionInputEntity[][] {
  const maxChars = Number(process.env.DESCRIPTION_FUSION_MAX_CHARS || 24000);
  const groups: FusionInputEntity[][] = [];
  let current: FusionInputEntity[] = [];
  let currentChars = 0;

  for (const input of inputs) {
    const estimated = input.currentDescription.length + input.name.length + input.aliases.join('').length + 80;
    if (current.length > 0 && currentChars + estimated > maxChars) {
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

function buildUserPrompt(group: FusionInputEntity[]): string {
  const payload = {
    characters: group
      .filter((entity) => entity.kind === 'characters')
      .map(({ name, aliases, currentDescription }) => ({ name, aliases, currentDescription })),
    items: group
      .filter((entity) => entity.kind === 'items')
      .map(({ name, aliases, currentDescription }) => ({ name, aliases, currentDescription })),
    locations: group
      .filter((entity) => entity.kind === 'locations')
      .map(({ name, aliases, currentDescription }) => ({ name, aliases, currentDescription })),
  };

  return `请融合以下实体简介。currentDescription 来自前面多个章节批次的原文概括，可能有重复、拼接痕迹或顺序混乱。请保留信息量，压成自然、完整、无重复的一段简介。\n\n${JSON.stringify(payload, null, 2)}`;
}

function outputKey(kind: EntityKind, name: string): string {
  return `${kind}:${normalizeName(name)}`;
}

function applyFusedDescriptions<T extends { name: string; description?: string }>(
  kind: EntityKind,
  entities: T[],
  fused: Map<string, string>
): T[] {
  return entities.map((entity) => {
    const llmDescription = cleanEntityDescription(fused.get(outputKey(kind, entity.name)));
    const fallbackDescription = normalizeEntityDescription(entity.description);
    const description = llmDescription || fallbackDescription;
    return {
      ...entity,
      ...(description ? { description } : {}),
    };
  });
}

function withCharacterDefaults(character: CharacterEntity): CharacterEntity {
  return {
    ...character,
    aliases: Array.isArray(character.aliases) ? character.aliases : [],
    description: character.description,
    confidence: character.confidence ?? 0,
    status: character.status ?? 'PENDING',
    chapterAppearances: Array.isArray(character.chapterAppearances) ? character.chapterAppearances : [],
    mentionCount: character.mentionCount ?? 0,
    dialogueCount: character.dialogueCount ?? 0,
    coCharacters: Array.isArray(character.coCharacters) ? character.coCharacters : [],
    outfits: Array.isArray(character.outfits) ? character.outfits : [],
  };
}

function deduplicateCharacters(characters: CharacterEntity[]): CharacterEntity[] {
  const normalized = characters
    .map(withCharacterDefaults)
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
  const resolved = resolve(normalized).characters as CharacterEntity[];
  return resolved.sort((a, b) => (b.mentionCount ?? 0) - (a.mentionCount ?? 0));
}

export async function executeDescriptionFusion(payload: unknown): Promise<DescriptionFusionResult> {
  const source = payload as DescriptionFusionPayload;
  const characters = sanitizeEntityAliases(deduplicateCharacters(source.characters || []));
  const items = sanitizeEntityAliases(deduplicateEntities(source.items || []));
  const locations = sanitizeEntityAliases(deduplicateEntities(source.locations || []));

  const inputs = [
    ...collectFusionInputs('characters', characters),
    ...collectFusionInputs('items', items),
    ...collectFusionInputs('locations', locations),
  ];

  if (inputs.length === 0) {
    return {
      ...source,
      characters,
      items,
      locations,
      descriptionFusion: { requested: 0, fused: 0, skipped: 0 },
    };
  }

  const provider = await getDefaultProvider();
  const fused = new Map<string, string>();

  for (const group of groupInputs(inputs)) {
    try {
      const result = await provider.chatExtract(
        DESCRIPTION_FUSION_SYSTEM_PROMPT,
        buildUserPrompt(group),
        fusionSchema
      );

      for (const entity of result.characters ?? []) {
        fused.set(outputKey('characters', entity.name), entity.description ?? '');
      }
      for (const entity of result.items ?? []) {
        fused.set(outputKey('items', entity.name), entity.description ?? '');
      }
      for (const entity of result.locations ?? []) {
        fused.set(outputKey('locations', entity.name), entity.description ?? '');
      }
    } catch (error) {
      console.warn(
        `[DescriptionFusion] LLM fusion group failed, using fallback descriptions for ${group.length} entities: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  const fusedCount = [...fused.values()].filter((description) => cleanEntityDescription(description)).length;

  return {
    ...source,
    characters: applyFusedDescriptions('characters', characters, fused),
    items: applyFusedDescriptions('items', items, fused),
    locations: applyFusedDescriptions('locations', locations, fused),
    descriptionFusion: {
      requested: inputs.length,
      fused: fusedCount,
      skipped: inputs.length - fusedCount,
    },
  };
}
