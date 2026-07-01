/**
 * File writer for entity prescan results.
 * Writes entity files to output/{bookId}/ directory.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { EntityMention, EntityType } from './types.js';

const FILE_NAMES: Record<EntityType, string> = {
  character: 'character.txt',
  location: 'location.txt',
  item: 'item.txt',
  event: 'event.txt',
};

const ENTITY_TYPES: EntityType[] = ['character', 'location', 'item', 'event'];

export function formatEntityText(type: EntityType, mention: Pick<EntityMention, 'text' | 'aliases'>): string {
  if (type !== 'character' || !mention.aliases || mention.aliases.length === 0) {
    return mention.text;
  }

  const aliases = [...new Set(mention.aliases)].filter((alias) => alias && alias !== mention.text);
  if (aliases.length === 0) return mention.text;
  return `${mention.text}（别名：${aliases.join('、')}）`;
}

/**
 * Write entity mentions to per-type files.
 *
 * Format per line: 章节号|实体文本|来源|置信度
 *
 * @param bookId - book identifier for output directory
 * @param results - map of entity type to mentions
 * @param outputDir - root output directory (default: 'output')
 * @returns absolute path to the output directory
 */
export async function writeEntityFiles(
  bookId: string,
  results: Map<EntityType, EntityMention[]>,
  outputDir: string = 'output'
): Promise<string> {
  const bookDir = path.resolve(outputDir, bookId);

  return writeEntityFilesToDir(bookDir, results);
}

/**
 * Write entity mentions directly to an already chosen directory.
 *
 * This is used by the agent pipeline to keep prescan files under
 * output/{bookId}/intermediate/prescan instead of treating them as final output.
 */
export async function writeEntityFilesToDir(
  bookDir: string,
  results: Map<EntityType, EntityMention[]>
): Promise<string> {
  // Ensure directory exists
  await fs.promises.mkdir(bookDir, { recursive: true });

  for (const type of ENTITY_TYPES) {
    const mentions = results.get(type) || [];
    const filePath = path.join(bookDir, FILE_NAMES[type]);

    // Sort by chapter index, then by position
    const sorted = [...mentions].sort((a, b) => {
      if (a.chapterIndex !== b.chapterIndex) return a.chapterIndex - b.chapterIndex;
      return a.position - b.position;
    });

    // Dedup by text within same chapter
    const seen = new Set<string>();
    const lines: string[] = [];

    for (const m of sorted) {
      const key = `${m.chapterIndex}|${m.text}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const confidence = m.confidence.toFixed(2);
      lines.push(`${m.chapterIndex}|${formatEntityText(type, m)}|${m.source}|${confidence}`);
    }

    await fs.promises.writeFile(filePath, lines.join('\n') + '\n', 'utf-8');
  }

  return bookDir;
}

/**
 * Read entity files back into a map (for testing/validation).
 */
export async function readEntityFiles(
  bookId: string,
  outputDir: string = 'output'
): Promise<Map<EntityType, EntityMention[]>> {
  const bookDir = path.resolve(outputDir, bookId);
  const results = new Map<EntityType, EntityMention[]>();

  for (const type of ENTITY_TYPES) {
    const filePath = path.join(bookDir, FILE_NAMES[type]);
    const mentions: EntityMention[] = [];

    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      for (const line of content.split('\n')) {
        if (!line.trim()) continue;
        const [chapterStr, text, source, confStr] = line.split('|');
        mentions.push({
          text,
          chapterIndex: parseInt(chapterStr, 10),
          position: -1,
          source: source as 'regex' | 'llm',
          confidence: parseFloat(confStr),
        });
      }
    } catch {
      // File may not exist if no entities found
    }

    results.set(type, mentions);
  }

  return results;
}
