/**
 * LLM-based entity completion.
 * After regex pre-scan, send results + chapter text to LLM
 * to find entities the regex missed.
 *
 * Batches multiple chapters per API call to reduce latency.
 */
import { getDefaultProvider } from '@novel-agent/llm';
import { z } from 'zod';
import type { EntityMention, EntityType, ScanChapter, TypeStats } from './types.js';

// ─── Zod schema for LLM structured output ───

const llmEntitySchema = z.object({
  text: z.string(),
  type: z.enum(['character', 'location', 'item', 'event']),
  confidence: z.number().min(0).max(1),
});

type LLMEntity = z.infer<typeof llmEntitySchema>;

/**
 * Normalize LLM entity field names to our expected format.
 * Different LLMs may use different field names (e.g. entity_type vs type).
 */
function normalizeEntity(raw: Record<string, unknown>): LLMEntity | null {
  const text = (raw.text || raw.entity_text || raw.name || raw.entity) as string | undefined;
  const type = (raw.type || raw.entity_type || raw.category) as string | undefined;
  const confidence = (raw.confidence || raw.score || raw.probability) as number | undefined;

  if (!text || !type) return null;

  // Normalize type
  const typeMap: Record<string, string> = {
    'character': 'character', '人物': 'character', 'person': 'character', 'people': 'character',
    'location': 'location', '地点': 'location', 'place': 'location',
    'item': 'item', '物品': 'item', 'object': 'item', 'weapon': 'item', 'treasure': 'item',
  };

  typeMap['event'] = 'event';
  typeMap['事件'] = 'event';
  typeMap['plot'] = 'event';
  typeMap['action'] = 'event';

  const normalizedType = typeMap[type.toLowerCase()] || type;

  // Validate type
  if (!['character', 'location', 'item', 'event'].includes(normalizedType)) return null;

  return {
    text: String(text),
    type: normalizedType as LLMEntity['type'],
    confidence: typeof confidence === 'number' ? Math.max(0, Math.min(1, confidence)) : 0.7,
  };
}

/**
 * Parse LLM response that may be in various formats:
 * - [{text, type, confidence}] (standard)
 * - [{entity_text, entity_type, confidence}] (MiniMax style)
 * - { "entities": [...] } (object wrapper)
 * - Nested in markdown code blocks
 */
function parseEntitiesFromResponse(raw: unknown): LLMEntity[] {
  // Direct array
  if (Array.isArray(raw)) {
    const results: LLMEntity[] = [];
    for (const item of raw) {
      if (item && typeof item === 'object') {
        const normalized = normalizeEntity(item as Record<string, unknown>);
        if (normalized) results.push(normalized);
      }
    }
    return results;
  }
  // Object with entities/data/results key
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const arr = obj.entities || obj.data || obj.results;
    if (Array.isArray(arr)) {
      return parseEntitiesFromResponse(arr);
    }
  }
  // Can't parse — return empty
  return [];
}

// ─── Prompt templates ───

const SYSTEM_PROMPT = `你是一个中文小说实体识别专家。你的任务是从给定的章节文本中，找出正则扫描遗漏的三类实体：

1. **人物** (character)：人名、称谓、代号（如"张三"、"老道"、"黑衣人"）
2. **地点** (location)：地名、建筑、场所（如"长安城"、"天机阁"、"客栈"）
3. **物品** (item)：武器、法宝、丹药、书籍（如"青锋剑"、"九转金丹"）

要求：
- 只提取正则可能遗漏的实体（如无后缀的地点、无对话动词的人名）
- confidence 表示你对该实体的确定程度（0-1）
- 输出 JSON 格式`;

function buildBatchPrompt(
  chapters: ScanChapter[],
  regexMentions: Map<number, Map<EntityType, Set<string>>>
): string {
  const parts: string[] = [];

  for (const chapter of chapters) {
    const regexSummary = Array.from((regexMentions.get(chapter.index) || new Map()).entries())
      .map(([type, texts]) => `[${type}] 已发现: ${Array.from(texts).slice(0, 10).join(', ')}${texts.size > 10 ? ` (共${texts.size}个)` : ''}`)
      .join('\n');

    // Truncate each chapter to fit context window
    const maxLen = 2000;
    const content = chapter.content.length > maxLen
      ? chapter.content.slice(0, maxLen) + '...(截断)'
      : chapter.content;

    parts.push(`=== 章节 ${chapter.index}${chapter.title ? `: ${chapter.title}` : ''} ===
正则已发现：
${regexSummary || '(无)'}

${content}`);
  }

  return `请从以下 ${chapters.length} 个章节中，找出正则遗漏的实体（不要重复已有结果）。

${parts.join('\n\n')}`;
}

// ─── Main completion function ───

const MAX_RETRIES = 2;

/**
 * Run LLM completion on chapters to find missed entities.
 * Sends multiple chapters per API call to reduce latency.
 *
 * @param chapters - chapters to scan
 * @param regexResults - per-chapter regex results (used to avoid duplicates)
 * @param batchSize - chapters per LLM call (default: 5)
 * @returns additional EntityMention[] per type
 */
export async function llmComplete(
  chapters: ScanChapter[],
  regexResults: Map<number, Map<EntityType, EntityMention[]>>,
  batchSize: number = 5
): Promise<{ mentions: Map<EntityType, EntityMention[]>; stats: Map<EntityType, TypeStats> }> {
  const provider = await getDefaultProvider();

  const allMentions: Map<EntityType, EntityMention[]> = new Map([
    ['character', []],
    ['location', []],
    ['item', []],
    ['event', []],
  ]);

  const stats: Map<EntityType, TypeStats> = new Map([
    ['character', { regexCount: 0, llmCount: 0, afterDedup: 0 }],
    ['location', { regexCount: 0, llmCount: 0, afterDedup: 0 }],
    ['item', { regexCount: 0, llmCount: 0, afterDedup: 0 }],
    ['event', { regexCount: 0, llmCount: 0, afterDedup: 0 }],
  ]);

  // Count regex totals
  for (const [, chapterResults] of regexResults) {
    for (const [type, mentions] of chapterResults) {
      stats.get(type)!.regexCount += mentions.length;
    }
  }

  // Process in batches — multiple chapters per API call
  for (let i = 0; i < chapters.length; i += batchSize) {
    const batch = chapters.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(chapters.length / batchSize);

    // Build regex text sets for this batch
    const batchRegexTexts = new Map<number, Map<EntityType, Set<string>>>();
    for (const chapter of batch) {
      const chapterRegex = regexResults.get(chapter.index) || new Map<EntityType, EntityMention[]>();
      const textSets = new Map<EntityType, Set<string>>();
      for (const type of ['character', 'location', 'item', 'event'] as EntityType[]) {
        const mentions = chapterRegex.get(type) || [];
        textSets.set(type, new Set(mentions.map(m => m.text)));
      }
      batchRegexTexts.set(chapter.index, textSets);
    }

    const userPrompt = buildBatchPrompt(batch, batchRegexTexts);

    let lastError: string | undefined;
    for (let retry = 0; retry < MAX_RETRIES; retry++) {
      try {
        // Use a loose schema that accepts any JSON, then parse entities manually
        const looseSchema = z.any();
        const rawResult = await provider.chatExtract(
          SYSTEM_PROMPT,
          userPrompt,
          looseSchema
        );

        const entities = parseEntitiesFromResponse(rawResult);

        // Map LLM entities back to chapters
        for (const entity of entities) {
          const type = entity.type as EntityType;

          // Find which chapter this entity belongs to
          // LLM should include chapter info, but if not, assign to first chapter in batch
          const targetChapter = batch[0];

          // Skip if regex already found this text in any chapter of the batch
          let alreadyFound = false;
          for (const chapter of batch) {
            const regexTexts = batchRegexTexts.get(chapter.index);
            if (regexTexts?.get(type)?.has(entity.text)) {
              alreadyFound = true;
              break;
            }
          }
          if (alreadyFound) continue;

          const mention: EntityMention = {
            text: entity.text,
            chapterIndex: targetChapter.index,
            position: -1,
            source: 'llm',
            confidence: entity.confidence,
            aliasIndex: [],
          };
          allMentions.get(type)!.push(mention);
          stats.get(type)!.llmCount++;
        }

        console.log(`  [LLM] 批次 ${batchNum}/${totalBatches} 完成, 发现 ${entities.length} 个实体`);
        break; // success
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        if (retry < MAX_RETRIES - 1) {
          await new Promise(r => setTimeout(r, Math.pow(2, retry) * 1000));
        }
      }
    }

    if (lastError) {
      console.warn(`[entity-prescan] LLM batch ${batchNum}/${totalBatches} failed: ${lastError}`);
    }
  }

  // Dedup LLM results
  for (const [type, mentions] of allMentions) {
    const seen = new Set<string>();
    const deduped: EntityMention[] = [];
    for (const m of mentions) {
      if (!seen.has(m.text)) {
        seen.add(m.text);
        deduped.push(m);
      }
    }
    allMentions.set(type, deduped);
    stats.get(type)!.afterDedup = deduped.length;
  }

  return { mentions: allMentions, stats };
}
