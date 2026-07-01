import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { readEntityFiles, writeEntityFiles, writeEntityFilesToDir } from './writer.js';
import type { EntityMention, EntityType } from './types.js';

describe('entity file writer', () => {
  it('writes and reads event.txt with the other output files', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'entity-prescan-'));
    const event: EntityMention = {
      text: '\u8bb8\u4e03\u5b89\u7834\u83b7\u7a0e\u94f6\u6848',
      chapterIndex: 3,
      position: 0,
      source: 'regex',
      confidence: 0.9,
    };

    try {
      await writeEntityFiles('book', new Map<EntityType, EntityMention[]>([
        ['event', [event]],
      ]), outputDir);

      const results = await readEntityFiles('book', outputDir);

      expect(results.get('event')?.map((mention) => mention.text)).toEqual([event.text]);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it('writes character aliases next to the canonical name for review', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'entity-prescan-'));
    const character: EntityMention = {
      text: '许七安',
      aliases: ['许宁宴'],
      chapterIndex: 0,
      position: 0,
      source: 'regex',
      confidence: 0.95,
    };

    try {
      await writeEntityFiles('book', new Map<EntityType, EntityMention[]>([
        ['character', [character]],
      ]), outputDir);

      const results = await readEntityFiles('book', outputDir);

      expect(results.get('character')?.map((mention) => mention.text)).toEqual([
        '许七安（别名：许宁宴）',
      ]);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it('writes directly to a provided directory for intermediate pipeline artifacts', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'entity-prescan-direct-'));
    const character: EntityMention = {
      text: '萧炎',
      chapterIndex: 1,
      position: 0,
      source: 'regex',
      confidence: 0.95,
    };

    try {
      await writeEntityFilesToDir(outputDir, new Map<EntityType, EntityMention[]>([
        ['character', [character]],
      ]));

      const results = await readEntityFiles('', outputDir);

      expect(results.get('character')?.map((mention) => mention.text)).toEqual(['萧炎']);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });
});
