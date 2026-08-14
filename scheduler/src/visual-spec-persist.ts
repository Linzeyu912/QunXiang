import type { VisualSpec, VisualSpecEntityType } from '@novel-agent/core';

export interface PromptVariantLike {
  stage?: string;
  prompt?: string;
  source?: string;
  sourceChapters?: string;
  isPrimary?: boolean;
}

export interface OutfitVariantLike {
  scene?: string;
  description?: string;
  prompt?: string;
  source?: string;
  sourceChapters?: string;
}

export interface PromptLike {
  entityName?: string;
  entityType?: string;
  prompt?: string;
  source?: string;
  quality?: string;
  styleTags?: string[];
  variants?: PromptVariantLike[];
  outfitVariants?: OutfitVariantLike[];
  description?: string;
  enhancedDescription?: string;
}

export interface VisualSpecDraft {
  bookId: string;
  entityType: VisualSpecEntityType;
  entityName: string;
  variantKey: string;
  prompt: string;
  promptSource: string;
  quality?: string | null;
  styleTags: string[];
  sourceChapters?: string | null;
  payload: Record<string, unknown>;
}

const ENTITY_TYPES = new Set<VisualSpecEntityType>(['character', 'location', 'item']);

export function slugOutfitKey(description: string): string {
  return description.trim().slice(0, 20);
}

export function outfitVariantKey(scene?: string, description?: string): string {
  const sceneKey = scene?.trim();
  if (sceneKey) return `outfit:${sceneKey}`;
  return `outfit:${slugOutfitKey(description ?? 'unnamed')}`;
}

export function ageVariantKey(stage: string): string {
  return `age:${stage}`;
}

function asEntityType(value: string | undefined): VisualSpecEntityType | null {
  if (value && ENTITY_TYPES.has(value as VisualSpecEntityType)) {
    return value as VisualSpecEntityType;
  }
  return null;
}

function payloadBase(prompt: PromptLike): Record<string, unknown> {
  return {
    description: prompt.description,
    enhancedDescription: prompt.enhancedDescription,
  };
}

/** 把一条生成提示词展开成 primary + age + outfit 草稿。 */
export function expandPromptToDrafts(bookId: string, prompt: PromptLike): VisualSpecDraft[] {
  const entityName = prompt.entityName?.trim();
  const entityType = asEntityType(prompt.entityType);
  if (!entityName || !entityType) return [];

  const styleTags = Array.isArray(prompt.styleTags) ? prompt.styleTags.filter((t) => typeof t === 'string') : [];
  const drafts: VisualSpecDraft[] = [];
  const seen = new Set<string>();

  const push = (draft: VisualSpecDraft) => {
    if (!draft.prompt.trim() || seen.has(draft.variantKey)) return;
    seen.add(draft.variantKey);
    drafts.push(draft);
  };

  if (prompt.prompt?.trim()) {
    push({
      bookId,
      entityType,
      entityName,
      variantKey: 'primary',
      prompt: prompt.prompt,
      promptSource: prompt.source || 'template-only',
      quality: prompt.quality ?? null,
      styleTags,
      sourceChapters: null,
      payload: { ...payloadBase(prompt), kind: 'primary' },
    });
  }

  for (const variant of prompt.variants ?? []) {
    if (!variant.stage || !variant.prompt?.trim()) continue;
    push({
      bookId,
      entityType,
      entityName,
      variantKey: ageVariantKey(variant.stage),
      prompt: variant.prompt,
      promptSource: variant.source || prompt.source || 'template-only',
      quality: prompt.quality ?? null,
      styleTags,
      sourceChapters: variant.sourceChapters ?? null,
      payload: { ...payloadBase(prompt), kind: 'age', stage: variant.stage, isPrimary: Boolean(variant.isPrimary) },
    });
  }

  for (const outfit of prompt.outfitVariants ?? []) {
    if (!outfit.prompt?.trim()) continue;
    push({
      bookId,
      entityType,
      entityName,
      variantKey: outfitVariantKey(outfit.scene, outfit.description),
      prompt: outfit.prompt,
      promptSource: outfit.source || prompt.source || 'template-only',
      quality: prompt.quality ?? null,
      styleTags,
      sourceChapters: outfit.sourceChapters ?? null,
      payload: {
        ...payloadBase(prompt),
        kind: 'outfit',
        scene: outfit.scene ?? null,
        description: outfit.description ?? null,
      },
    });
  }

  return drafts;
}

export function buildVisualSpecDrafts(bookId: string, prompts: PromptLike[]): VisualSpecDraft[] {
  return prompts.flatMap((prompt) => expandPromptToDrafts(bookId, prompt));
}

export function versionKey(entityType: string, entityName: string, variantKey: string): string {
  return `${entityType}\0${entityName}\0${variantKey}`;
}

export function collectPromptsFromResult(result: unknown): PromptLike[] {
  if (!result || typeof result !== 'object') return [];
  const payload = result as Record<string, unknown>;
  const buckets = [payload.characterPrompts, payload.itemPrompts, payload.locationPrompts];
  const prompts: PromptLike[] = [];
  for (const bucket of buckets) {
    if (!Array.isArray(bucket)) continue;
    for (const item of bucket) {
      if (item && typeof item === 'object') prompts.push(item as PromptLike);
    }
  }
  return prompts;
}

export interface SpecPromptPick {
  variantKey: string;
  prompt: string;
  payload: Record<string, unknown>;
}

function payloadString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === 'string' ? value : '';
}

/** 按生图 query（outfit / stage）从 ACTIVE specs 里挑一条，匹配规则与旧 JSON 读取一致。 */
export function pickActiveSpec(
  specs: Array<Pick<VisualSpec, 'variantKey' | 'prompt' | 'payload'>>,
  opts: { stage?: string; outfit?: string } = {},
): SpecPromptPick | null {
  if (specs.length === 0) return null;

  if (opts.outfit) {
    const outfit = opts.outfit;
    const outfits = specs.filter((spec) => spec.variantKey.startsWith('outfit:'));
    const picked = outfits.find((spec) => spec.variantKey === outfitVariantKey(outfit))
      ?? outfits.find((spec) => payloadString(spec.payload, 'scene') === outfit)
      ?? outfits.find((spec) => payloadString(spec.payload, 'description') === outfit)
      ?? outfits.find((spec) => payloadString(spec.payload, 'scene').includes(outfit))
      ?? outfits.find((spec) => payloadString(spec.payload, 'description').startsWith(outfit));
    return picked ? { variantKey: picked.variantKey, prompt: picked.prompt, payload: picked.payload } : null;
  }

  if (opts.stage) {
    const key = ageVariantKey(opts.stage);
    const picked = specs.find((spec) => spec.variantKey === key)
      ?? specs.find((spec) => payloadString(spec.payload, 'stage') === opts.stage);
    if (picked) return { variantKey: picked.variantKey, prompt: picked.prompt, payload: picked.payload };
  }

  const primary = specs.find((spec) => spec.variantKey === 'primary')
    ?? specs.find((spec) => spec.payload.kind === 'primary')
    ?? specs[0];
  return primary ? { variantKey: primary.variantKey, prompt: primary.prompt, payload: primary.payload } : null;
}
