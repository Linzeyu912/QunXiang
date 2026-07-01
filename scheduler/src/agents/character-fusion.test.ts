import { describe, expect, it } from 'vitest';
import { fuseCharactersWithPrescan } from './character-fusion.js';
import type { Character } from '@novel-agent/core';
import type { EntityMention } from '@novel-agent/entity-prescan';

type CharacterCandidate = Omit<Character, 'id' | 'bookId' | 'createdAt' | 'updatedAt'>;

describe('fuseCharactersWithPrescan', () => {
  it('drops prescan-only characters — LLM is authoritative for the character set', () => {
    const llmCharacters: CharacterCandidate[] = [
      {
        name: '萧炎',
        aliases: [],
        description: '萧家少年',
        confidence: 0.92,
        status: 'PENDING',
        firstChapter: 1,
        lastChapter: 2,
        chapterAppearances: [1, 2],
        mentionCount: 12,
        dialogueCount: 3,
        coCharacters: [],
      },
    ];

    const prescanMentions: EntityMention[] = [
      {
        text: '药老',
        aliases: [],
        chapterIndex: 3,
        position: 12,
        source: 'regex',
        confidence: 0.86,
        totalCount: 5,
        allChapters: [3, 4],
      },
    ];

    const fused = fuseCharactersWithPrescan(llmCharacters, prescanMentions);

    // 药老 was not found by the LLM → not added (old behavior added it as a
    // prescan-only character, producing false positives like 萧炎哥/云岚宗).
    expect(fused.map((character) => character.name)).toEqual(['萧炎']);
  });

  it('keeps the LLM name canonical and enriches with the matching prescan mention', () => {
    const llmCharacters: CharacterCandidate[] = [
      {
        name: '许宁宴',
        aliases: [],
        description: '主角，京城捕快',
        confidence: 0.88,
        status: 'PENDING',
        firstChapter: 1,
        lastChapter: 5,
        chapterAppearances: [1, 2, 5],
        mentionCount: 20,
        dialogueCount: 4,
        coCharacters: ['魏渊'],
      },
    ];

    const prescanMentions: EntityMention[] = [
      {
        text: '许七安',
        aliases: ['许宁宴'],
        chapterIndex: 1,
        position: 0,
        source: 'regex',
        confidence: 0.95,
        totalCount: 33,
        allChapters: [1, 2, 3, 4, 5],
      },
    ];

    const fused = fuseCharactersWithPrescan(llmCharacters, prescanMentions);

    expect(fused).toHaveLength(1);
    expect(fused[0]).toMatchObject({
      name: '许宁宴', // LLM name kept; prescan primary no longer overrides it
      aliases: ['许七安'], // prescan name recorded as alias
      description: '主角，京城捕快',
      confidence: 0.95,
      firstChapter: 1,
      lastChapter: 5,
      chapterAppearances: [1, 2, 3, 4, 5],
      mentionCount: 33,
      dialogueCount: 4,
      coCharacters: ['魏渊'],
    });
  });

  it('merges exact prescan matches without duplicating aliases', () => {
    const llmCharacters: CharacterCandidate[] = [
      {
        name: '魏渊',
        aliases: ['魏公'],
        description: '权臣',
        confidence: 0.9,
        status: 'PENDING',
        firstChapter: 2,
        lastChapter: 8,
        chapterAppearances: [2, 8],
        mentionCount: 9,
        dialogueCount: 1,
        coCharacters: [],
      },
    ];

    const prescanMentions: EntityMention[] = [
      {
        text: '魏渊',
        aliases: ['魏公'],
        chapterIndex: 2,
        position: 4,
        source: 'regex',
        confidence: 0.93,
        totalCount: 11,
        allChapters: [2, 3, 8],
      },
    ];

    const fused = fuseCharactersWithPrescan(llmCharacters, prescanMentions);

    expect(fused).toHaveLength(1);
    expect(fused[0].aliases).toEqual(['魏公']);
    expect(fused[0].mentionCount).toBe(11);
    expect(fused[0].chapterAppearances).toEqual([2, 3, 8]);
  });

  it('preserves complementary descriptions when duplicate LLM characters are fused', () => {
    const llmCharacters: CharacterCandidate[] = [
      {
        name: '萧炎',
        aliases: ['炎儿'],
        description: '萧家三少爷，曾被视为天才少年。',
        confidence: 0.9,
        status: 'PENDING',
        firstChapter: 1,
        lastChapter: 2,
        chapterAppearances: [1, 2],
        mentionCount: 8,
        dialogueCount: 1,
        coCharacters: [],
      },
      {
        name: '萧炎',
        aliases: ['三少爷'],
        description: '身怀黑色古戒，并在退婚冲突中写下休书。',
        confidence: 0.88,
        status: 'PENDING',
        firstChapter: 3,
        lastChapter: 5,
        chapterAppearances: [3, 5],
        mentionCount: 6,
        dialogueCount: 2,
        coCharacters: [],
      },
    ];

    const prescanMentions: EntityMention[] = [
      {
        text: '萧炎',
        aliases: ['炎儿'],
        chapterIndex: 1,
        position: 0,
        source: 'regex',
        confidence: 0.92,
        totalCount: 14,
        allChapters: [1, 2, 3, 5],
      },
    ];

    const fused = fuseCharactersWithPrescan(llmCharacters, prescanMentions);

    expect(fused).toHaveLength(1);
    expect(fused[0].description).toContain('萧家三少爷');
    expect(fused[0].description).toContain('黑色古戒');
    expect(fused[0].description).toContain('退婚冲突');
  });

  it('removes incomplete trailing description fragments when duplicate LLM characters are fused', () => {
    const llmCharacters: CharacterCandidate[] = [
      {
        name: '纳兰嫣然',
        aliases: ['嫣然'],
        description: '云岚宗宗主云韵的亲传弟子，与萧炎指腹为婚，最终被萧炎以休书反将一',
        confidence: 0.9,
        status: 'PENDING',
        firstChapter: 3,
        lastChapter: 3,
        chapterAppearances: [3],
        mentionCount: 5,
        dialogueCount: 1,
        coCharacters: [],
      },
      {
        name: '纳兰嫣然',
        aliases: ['纳兰小姐'],
        description: '奉师命前往萧家解除婚约。',
        confidence: 0.88,
        status: 'PENDING',
        firstChapter: 3,
        lastChapter: 4,
        chapterAppearances: [3, 4],
        mentionCount: 4,
        dialogueCount: 1,
        coCharacters: [],
      },
    ];

    const prescanMentions: EntityMention[] = [
      {
        text: '纳兰嫣然',
        aliases: ['嫣然'],
        chapterIndex: 3,
        position: 0,
        source: 'regex',
        confidence: 0.9,
        totalCount: 9,
        allChapters: [3, 4],
      },
    ];

    const fused = fuseCharactersWithPrescan(llmCharacters, prescanMentions);

    expect(fused[0].description).toContain('云韵的亲传弟子');
    expect(fused[0].description).toContain('解除婚约');
    expect(fused[0].description).not.toContain('反将一');
  });
});
