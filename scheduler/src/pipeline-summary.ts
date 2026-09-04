import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { BookRepository, CharacterRepository, LocationRepository, ItemRepository, WorldviewRepository, persistBookArtifact } from '@qunxiang/storage';
import { bookSlug } from '@qunxiang/story-arcs';

type NamedEntity = { name?: unknown };
type DescriptionPayload = {
  entityType?: unknown;
  name?: unknown;
  sourceDescription?: unknown;
};

function namesFrom(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item: NamedEntity) => typeof item?.name === 'string' ? item.name : undefined)
    .filter((name): name is string => Boolean(name));
}

function descriptionPacksFromPayload(
  payload: Record<string, unknown>,
  key: string,
  entityType: string
): DescriptionPayload[] {
  const value = payload[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is DescriptionPayload => {
    return Boolean(item && typeof item === 'object' && (item as DescriptionPayload).entityType === entityType);
  });
}

export interface FailedBatchInfo {
  batch: number;
  error: string;
  chapterFrom?: number;
  chapterTo?: number;
}

export interface PipelineSummary {
  bookId: string;
  status: 'completed';
  officialResult: true;
  generatedAt: string;
  counts: {
    characters: number;
    locations: number;
    items: number;
    worldviews: number;
  };
  outputs: {
    finalSummary: string;
    prescanIntermediate: string;
    entities: string;
  };
  entities: {
    characters: string[];
    locations: string[];
    items: string[];
    worldviews: string[];
  };
  /** 提取阶段彻底失败（重试+拆章降级均未成功）的批次：对应章节实体缺失，静默丢失会误导用户 */
  failedBatches?: FailedBatchInfo[];
  reviewer: unknown;
}

export function buildPipelineSummary(
  bookId: string,
  reviewerPayload: unknown,
  reviewerResult: unknown,
  generatedAt = new Date().toISOString(),
  dirName = bookId
): PipelineSummary {
  const payload = reviewerPayload && typeof reviewerPayload === 'object'
    ? reviewerPayload as Record<string, unknown>
    : {};
  const characters = namesFrom(payload.characters);
  const locations = namesFrom(payload.locations);
  const items = namesFrom(payload.items);
  const worldviews = namesFrom(payload.worldviews);

  // 提取阶段的失败批次随 payload 一路传到 reviewer——非空时写入运行摘要，
  // 让"部分章节实体缺失"从静默变为可查（此前只进服务端日志）
  const failedBatches = Array.isArray(payload.failedBatches)
    ? (payload.failedBatches as FailedBatchInfo[]).filter(
        (b) => b && typeof b === 'object' && typeof b.error === 'string'
      )
    : [];

  return {
    bookId,
    status: 'completed',
    officialResult: true,
    generatedAt,
    counts: {
      characters: characters.length,
      locations: locations.length,
      items: items.length,
      worldviews: worldviews.length,
    },
    outputs: {
      finalSummary: `output/${dirName}/final/run-summary.json`,
      prescanIntermediate: `.intermediate/${dirName}/prescan`,
      entities: `output/${dirName}/entities`,
    },
    entities: {
      characters,
      locations,
      items,
      worldviews,
    },
    ...(failedBatches.length > 0 ? { failedBatches } : {}),
    reviewer: reviewerResult,
  };
}

export async function writePipelineFinalSummary(
  bookId: string,
  reviewerPayload: unknown,
  reviewerResult: unknown,
  outputRoot = 'output'
): Promise<string> {
  // Resolve directory name: prefer runDirName from pipeline payload (includes
  // timestamp to avoid overwriting previous runs), fall back to book slug.
  let dirName = bookId;
  let bookTitle = bookId;

  // Check payload for runDirName (set by extractor, preserved through pipeline)
  const payload = reviewerPayload && typeof reviewerPayload === 'object'
    ? reviewerPayload as Record<string, unknown>
    : {};
  if (typeof payload.runDirName === 'string' && payload.runDirName) {
    dirName = payload.runDirName;
    bookTitle = payload.runDirName.replace(/-\d{12}$/, ''); // strip timestamp for display
  }

  try {
    const book = await BookRepository.findById(bookId);
    if (book?.title) {
      bookTitle = bookTitle === bookId ? book.title : bookTitle;
      if (dirName === bookId) dirName = bookSlug(book.title) || bookId;
    }
  } catch { /* DB not available — fall back to bookId */ }

  const summary = buildPipelineSummary(bookId, reviewerPayload, reviewerResult, undefined, dirName);
  const finalDir = join(outputRoot, dirName, 'final');
  const filePath = join(finalDir, 'run-summary.json');

  const runSummaryBody = JSON.stringify(summary, null, 2) + '\n';

  // Write final entity results to output/{dirName}/entities/ (from DB = truly final,
  // after validation + resolution). Events come from the payload (preserved through
  // the pipeline from the extractor's prescan result).
  await writeEntityOutput(bookId, dirName, bookTitle, reviewerPayload, outputRoot);

  // run-summary.json 必须最后写：产物接口以它判定该 run "available"。若先写它，
  // entities/*.json（含提示词）还在写入时前端就会拿到"available 但提示词为空"
  // 的响应并被 react-query 缓存住，表现为"提取完成了，提示词却迟迟不出现"。
  await mkdir(finalDir, { recursive: true });
  await writeFile(filePath, runSummaryBody, 'utf-8');
  // 双写到对象存储 + BookArtifact（logicalPath 不含 runDir，最新 run 覆盖）。
  await persistBookArtifact({
    bookId,
    logicalPath: 'run-summary.json',
    category: 'run-summary',
    body: runSummaryBody,
    mime: 'application/json',
  });

  return filePath;
}

async function writeEntityOutput(
  bookId: string,
  dirName: string,
  bookTitle: string,
  reviewerPayload: unknown,
  outputRoot: string
): Promise<void> {
  try {
    const payload = reviewerPayload && typeof reviewerPayload === 'object'
      ? reviewerPayload as Record<string, unknown>
      : {};
    const events = Array.isArray(payload.events) ? payload.events : [];
    const descriptionOutputs = [
      {
        filename: 'character-descriptions.json',
        packs: descriptionPacksFromPayload(payload, 'characterDescriptions', 'character'),
      },
      {
        filename: 'item-descriptions.json',
        packs: descriptionPacksFromPayload(payload, 'itemDescriptions', 'item'),
      },
      {
        filename: 'location-descriptions.json',
        packs: descriptionPacksFromPayload(payload, 'locationDescriptions', 'location'),
      },
      {
        filename: 'character-visual-descriptions.json',
        packs: descriptionPacksFromPayload(payload, 'characterVisualDescriptions', 'character'),
      },
      {
        filename: 'item-visual-descriptions.json',
        packs: descriptionPacksFromPayload(payload, 'itemVisualDescriptions', 'item'),
      },
      {
        filename: 'location-visual-descriptions.json',
        packs: descriptionPacksFromPayload(payload, 'locationVisualDescriptions', 'location'),
      },
    ];

    const entitiesDir = join(outputRoot, dirName, 'entities');
    await mkdir(entitiesDir, { recursive: true });
    // 双写：本机 output/ 落盘后同步到对象存储 + BookArtifact（logicalPath 不含 runDir）。
    const writeJson = async (filename: string, data: unknown) => {
      const body = JSON.stringify(data, null, 2) + '\n';
      await writeFile(join(entitiesDir, filename), body, 'utf-8');
      await persistBookArtifact({
        bookId,
        logicalPath: `entities/${filename}`,
        category: 'extraction',
        body,
        mime: 'application/json',
      });
    };
    const writeText = async (filename: string, text: string, mime: string) => {
      await writeFile(join(entitiesDir, filename), text, 'utf-8');
      await persistBookArtifact({
        bookId,
        logicalPath: `entities/${filename}`,
        category: 'extraction',
        body: text,
        mime,
      });
    };
    for (const output of descriptionOutputs) {
      if (output.packs.length > 0) {
        await writeJson(output.filename, output.packs);
      }
    }

    const payloadCharacters = payloadEntitiesFrom<DbCharacter>(payload, 'characters');
    const payloadItems = payloadEntitiesFrom<DbEntity>(payload, 'items');
    const payloadLocations = payloadEntitiesFrom<DbEntity>(payload, 'locations');
    const payloadWorldviews = payloadEntitiesFrom<DbEntity>(payload, 'worldviews');

    const [dbCharacters, dbLocations, dbItems, dbWorldviews] = await Promise.all([
      safeRepositoryRead<DbCharacter>('characters', () => CharacterRepository.findByBookId(bookId)),
      safeRepositoryRead<DbEntity>('locations', () => LocationRepository.findByBookId(bookId)),
      safeRepositoryRead<DbEntity>('items', () => ItemRepository.findByBookId(bookId)),
      safeRepositoryRead<DbEntity>('worldviews', () => WorldviewRepository.findByBookId(bookId)),
    ]);
    const characters = preferPayloadEntities(dbCharacters, payloadCharacters);
    const items = preferPayloadEntities(dbItems, payloadItems);
    const locations = preferPayloadEntities(dbLocations, payloadLocations);
    const worldviews = preferPayloadEntities(dbWorldviews, payloadWorldviews);

    // Prompt-generation outputs (optional — may not exist in older runs)
    const promptFiles = [
      { filename: 'character-prompts.json', key: 'characterPrompts', label: '角色' },
      { filename: 'item-prompts.json', key: 'itemPrompts', label: '道具' },
      { filename: 'location-prompts.json', key: 'locationPrompts', label: '场景' },
    ];
    const promptWrites = promptFiles
      .filter((f) => Array.isArray(payload[f.key]) && (payload[f.key] as unknown[]).length > 0)
      .map((f) => writeJson(f.filename, payload[f.key]));

    // Build consolidated markdown prompt file for direct image generation use
    const promptMd = buildAllPromptsMarkdown(bookTitle, promptFiles, payload);

    await Promise.all([
      writeJson('characters.json', characters),
      writeJson('items.json', items),
      writeJson('locations.json', locations),
      writeJson('worldviews.json', worldviews),
      writeJson('events.json', events),
      writeText('summary.md', buildEntityMarkdown(bookTitle, characters, items, locations, events), 'text/markdown'),
      ...promptWrites,
    ]);
    if (promptMd) {
      await writeText('all-prompts.md', promptMd, 'text/markdown');
    }
    const promptSummary = promptFiles.map((f) => `${f.key}=${(Array.isArray(payload[f.key]) ? (payload[f.key] as unknown[]).length : 0)}`).join(', ');
    console.log(`[处理流水线] 实体输出：${entitiesDir}/（角色=${characters.length}，道具=${items.length}，场景=${locations.length}，世界观=${worldviews.length}，事件=${events.length}，提示词=${promptSummary}）`);
  } catch (err) {
    console.error(`[Pipeline] Failed to write entity output: ${err instanceof Error ? err.message : err}`);
  }
}

type DbEntity = { name?: string; aliases?: string[]; description?: string | null; importanceScore?: number | null; tier?: string | null; firstChapter?: number | null; lastChapter?: number | null; chapterAppearances?: number[]; mentionCount?: number | null };
type DbCharacter = DbEntity & { dialogueCount?: number | null; coCharacters?: string[] };
type EventMention = { text?: string; chapterIndex?: number; confidence?: number };

function payloadEntitiesFrom<T extends DbEntity>(payload: Record<string, unknown>, key: string): T[] {
  const value = payload[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is T => {
    return Boolean(item && typeof item === 'object' && typeof (item as DbEntity).name === 'string');
  });
}

async function safeRepositoryRead<T>(label: string, read: () => Promise<T[]>): Promise<T[]> {
  try {
    return await read();
  } catch (err) {
    console.warn(`[Pipeline] Repository ${label} unavailable, using pipeline payload entities: ${err instanceof Error ? err.message : err}`);
    return [];
  }
}

function entityKey(entity: DbEntity): string {
  return (entity.name || '').trim().toLocaleLowerCase();
}

function preferPayloadEntities<T extends DbEntity>(repositoryEntities: T[], payloadEntities: T[]): T[] {
  if (payloadEntities.length === 0) return repositoryEntities;

  const payloadByName = new Map(payloadEntities.map((entity) => [entityKey(entity), entity]));
  const seen = new Set<string>();
  const merged = repositoryEntities.map((entity) => {
    const key = entityKey(entity);
    seen.add(key);
    const payloadEntity = payloadByName.get(key);
    return payloadEntity ? { ...entity, ...payloadEntity } : entity;
  });

  for (const entity of payloadEntities) {
    const key = entityKey(entity);
    if (!seen.has(key)) {
      merged.push(entity);
      seen.add(key);
    }
  }

  return merged;
}

function markdownCell(value: string | number | null | undefined): string {
  if (value == null) return '';
  return String(value)
    .replace(/\r?\n/gu, '<br>')
    .replace(/\|/gu, '\\|')
    .trim();
}

function fullDescription(s: string | null | undefined): string {
  return markdownCell(s);
}

function aliasesStr(aliases?: string[] | null): string {
  if (!aliases || aliases.length === 0) return '';
  return aliases.join('、');
}

function chapterRange(first?: number | null, last?: number | null): string {
  if (first == null && last == null) return '';
  if (first === last) return `${first}`;
  return `${first ?? ''}-${last ?? ''}`;
}

type PromptEntry = { entityName?: string; entityType?: string; tier?: string; prompt?: string; quality?: string; source?: string };

function buildAllPromptsMarkdown(
  bookTitle: string,
  promptFiles: Array<{ filename: string; key: string; label: string }>,
  payload: Record<string, unknown>
): string | null {
  const lines: string[] = [];
  lines.push(`# 🎨 生图提示词全集：${bookTitle}`);
  lines.push('');
  lines.push('> 可直接复制粘贴到 Midjourney / DALL-E / Flux 等生图工具使用');
  lines.push('');

  let totalCount = 0;
  for (const { key, label } of promptFiles) {
    const entries = (Array.isArray(payload[key]) ? payload[key] as PromptEntry[] : [])
      .filter((e) => Boolean(e?.prompt));
    if (entries.length === 0) continue;
    totalCount += entries.length;

    lines.push(`## ${label}提示词（${entries.length}）`);
    lines.push('');

    // Sort: high quality first, then by tier
    const sorted = [...entries].sort((a, b) => {
      const qOrder = { high: 0, medium: 1, low: 2 } as Record<string, number>;
      return (qOrder[a.quality || 'medium'] ?? 1) - (qOrder[b.quality || 'medium'] ?? 1);
    });

    for (const entry of sorted) {
      const name = entry.entityName || '未知';
      const tierTag = entry.tier === 'core' ? '🔴' : entry.tier === 'supporting' ? '🟡' : entry.tier === 'candidate' ? '🟢' : '⚪';
      const qualityTag = entry.quality === 'high' ? '★' : entry.quality === 'medium' ? '☆' : '';
      lines.push(`### ${tierTag} ${name} ${qualityTag}`);
      lines.push('');
      // 多年龄阶段版本：每个阶段一个子块（带原文溯源）；否则单条
      const variants = Array.isArray((entry as any).variants) ? (entry as any).variants : undefined;
      if (variants && variants.length > 1) {
        for (const v of variants) {
          const source = v.sourceChapters ? `（原文依据：${v.sourceChapters}）` : '';
          lines.push(`#### ${v.label}${v.isPrimary ? ' ★' : ''}${source}`);
          lines.push('');
          lines.push('```');
          lines.push(v.prompt || '');
          lines.push('```');
          lines.push('');
        }
      } else {
        lines.push('```');
        lines.push(entry.prompt || '');
        lines.push('```');
        lines.push('');
      }
    }
  }

  if (totalCount === 0) return null;

  lines.push('---');
  lines.push(`> 共 ${totalCount} 条提示词 | 生成时间：${new Date().toISOString()}`);
  lines.push('');

  return lines.join('\n');
}

export function buildEntityMarkdown(
  bookTitle: string,
  characters: DbCharacter[],
  items: DbEntity[],
  locations: DbEntity[],
  events: EventMention[]
): string {
  const lines: string[] = [];
  lines.push(`# 实体提取结果：${bookTitle}`);
  lines.push('');
  lines.push(`> 角色 ${characters.length} | 物品 ${items.length} | 地点 ${locations.length} | 事件 ${events.length}`);
  lines.push('');

  // Characters
  lines.push(`## 角色（${characters.length}）`);
  lines.push('');
  lines.push('| 角色 | 别名 | 提及 | 对白 | 章节 | 简介 |');
  lines.push('|---|---|---|---|---|---|');
  for (const c of characters) {
    lines.push(`| ${markdownCell(c.name)} | ${markdownCell(aliasesStr(c.aliases))} | ${c.mentionCount ?? 0} | ${c.dialogueCount ?? 0} | ${markdownCell(chapterRange(c.firstChapter, c.lastChapter))} | ${fullDescription(c.description)} |`);
  }
  lines.push('');

  // Items
  lines.push(`## 物品（${items.length}）`);
  lines.push('');
  lines.push('| 物品 | 别名 | 章节 | 简介 |');
  lines.push('|---|---|---|---|');
  for (const it of items) {
    lines.push(`| ${markdownCell(it.name)} | ${markdownCell(aliasesStr(it.aliases))} | ${markdownCell(chapterRange(it.firstChapter, it.lastChapter))} | ${fullDescription(it.description)} |`);
  }
  lines.push('');

  // Locations
  lines.push(`## 地点（${locations.length}）`);
  lines.push('');
  lines.push('| 地点 | 章节 | 简介 |');
  lines.push('|---|---|---|');
  for (const loc of locations) {
    lines.push(`| ${markdownCell(loc.name)} | ${markdownCell(chapterRange(loc.firstChapter, loc.lastChapter))} | ${fullDescription(loc.description)} |`);
  }
  lines.push('');

  // Events
  if (events.length > 0) {
    lines.push(`## 事件（${events.length}）`);
    lines.push('');
    lines.push('| 章节 | 事件 |');
    lines.push('|---|---|');
    for (const e of events) {
      lines.push(`| 第${e.chapterIndex ?? '?'}章 | ${e.text ?? ''} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
