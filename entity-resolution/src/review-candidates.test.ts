import { describe, expect, it } from 'vitest';
import { buildCharacterMergeCandidates, mergeCharacterRecords } from './review-candidates.js';
import type { Character } from './types.js';

function character(overrides: Partial<Character> & Pick<Character, 'id' | 'name'>): Character {
  return {
    bookId: 'book-1',
    aliases: [],
    confidence: 0.8,
    status: 'PENDING',
    chapterAppearances: [],
    mentionCount: 0,
    dialogueCount: 0,
    coCharacters: [],
    outfits: [],
    createdAt: new Date('2026-08-16T00:00:00Z'),
    ...overrides,
  };
}

describe('buildCharacterMergeCandidates', () => {
  it('creates one review candidate instead of silently merging an address-form variant', () => {
    const candidates = buildCharacterMergeCandidates([
      character({ id: 'char-xiao-yan', name: '萧炎', aliases: ['炎儿'], chapterAppearances: [1, 12] }),
      character({ id: 'char-xiao-yan-ge', name: '萧炎哥', chapterAppearances: [12] }),
    ]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      primaryId: 'char-xiao-yan',
      secondaryId: 'char-xiao-yan-ge',
      reasons: ['称谓归一化'],
      primary: { chapterAppearances: [1, 12] },
      secondary: { chapterAppearances: [12] },
    });
  });

  it('creates an alias candidate for a safe explicit alias without treating unrelated names as duplicates', () => {
    const candidates = buildCharacterMergeCandidates([
      character({ id: 'char-yao-lao', name: '药老', aliases: ['药尊者'] }),
      character({ id: 'char-yao-zun-zhe', name: '药尊者' }),
      character({ id: 'char-xiao-zhan', name: '萧战' }),
    ]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].primaryId).toBe('char-yao-lao');
    expect(candidates[0].secondaryId).toBe('char-yao-zun-zhe');
    expect(candidates[0].reasons).toEqual(['已提取别名匹配']);
  });

  it('does not create a candidate for exact duplicate canonical names because resolution handles them automatically', () => {
    const candidates = buildCharacterMergeCandidates([
      character({ id: 'char-1', name: '萧炎' }),
      character({ id: 'char-2', name: '萧炎' }),
    ]);

    expect(candidates).toEqual([]);
  });

  it('creates a candidate when one name is the surname-stripped variant of the other (宁荣荣/荣荣)', () => {
    const candidates = buildCharacterMergeCandidates([
      character({ id: 'char-ning-rongrong', name: '宁荣荣', chapterAppearances: [5, 30] }),
      character({ id: 'char-rongrong', name: '荣荣', chapterAppearances: [8, 30] }),
    ]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].reasons).toContain('名称包含变体');
  });

  it('去姓变体对以带姓氏的全名为 primary（宁荣荣），不按置信度/提及数排序', () => {
    // 还原手动合并踩过的坑：荣荣提及数与置信度都更高，旧排序会以荣荣为保留方
    const candidates = buildCharacterMergeCandidates([
      character({ id: 'char-rongrong', name: '荣荣', confidence: 0.95, mentionCount: 9333, chapterAppearances: [31, 32] }),
      character({ id: 'char-ning', name: '宁荣荣', confidence: 0.6, mentionCount: 100, chapterAppearances: [31, 40] }),
    ]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].primaryId).toBe('char-ning');
    expect(candidates[0].primary.name).toBe('宁荣荣');
    expect(candidates[0].secondary.name).toBe('荣荣');
  });

  it('detects surname-stripped variants for compound given names (萧薰儿/薰儿)', () => {
    const candidates = buildCharacterMergeCandidates([
      character({ id: 'char-xiao-xun-er', name: '萧薰儿' }),
      character({ id: 'char-xun-er', name: '薰儿' }),
    ]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].reasons).toContain('名称包含变体');
  });

  it('does not treat unrelated names as surname-stripped variants', () => {
    const candidates = buildCharacterMergeCandidates([
      character({ id: 'char-tang-san', name: '唐三' }),
      character({ id: 'char-xiao-wu', name: '小舞' }),
      character({ id: 'char-wang-xiaoming', name: '王小明' }),
      character({ id: 'char-dai-mubai', name: '戴沐白' }),
    ]);

    expect(candidates).toEqual([]);
  });

  it('preserves the secondary name, evidence, and relationship fields when a reviewer accepts a merge', () => {
    const merged = mergeCharacterRecords(
      character({ id: 'primary', name: '萧炎', aliases: ['炎儿'], confidence: 0.9, chapterAppearances: [1], mentionCount: 3, coCharacters: ['药老'] }),
      character({ id: 'secondary', name: '萧炎哥', aliases: ['三少爷'], confidence: 0.8, chapterRef: '第12章', firstChapter: 12, lastChapter: 12, chapterAppearances: [12], mentionCount: 2, coCharacters: ['萧战'] }),
    );

    expect(merged.aliases).toEqual(['炎儿', '三少爷', '萧炎哥']);
    expect(merged.chapterAppearances).toEqual([1, 12]);
    expect(merged.chapterRef).toBe('第12章');
    expect(merged.mentionCount).toBe(5);
    expect(merged.coCharacters).toEqual(['药老', '萧战']);
  });

  it('derives a chapter range from appearances when the source records omit range fields', () => {
    const merged = mergeCharacterRecords(
      character({ id: 'primary', name: '萧炎', chapterAppearances: [3] }),
      character({ id: 'secondary', name: '萧炎哥', chapterAppearances: [8] }),
    );

    expect(merged.firstChapter).toBe(3);
    expect(merged.lastChapter).toBe(8);
  });
});
