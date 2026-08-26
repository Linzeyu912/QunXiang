import { describe, expect, it } from 'vitest';
import {
  chooseCanonicalCharacterName,
  isCollectiveCharacterAlias,
  sanitizeCharacterAliases,
} from './alias-safety.js';

describe('sanitizeCharacterAliases', () => {
  it('drops hallucinated aliases that do not appear in the source text', () => {
    const aliases = sanitizeCharacterAliases('药老', ['药老哥', '药老老师', '老头'], {
      sourceText: '药老笑道。老师说道。',
    });

    expect(aliases).not.toContain('药老哥');
    expect(aliases).not.toContain('药老老师');
  });

  it('deduplicates demonstrative aliases to their base form', () => {
    const aliases = sanitizeCharacterAliases('药老', ['神秘人', '那位神秘人'], {
      sourceText: '神秘人现身。那位神秘人看着萧炎。',
    });

    expect(aliases).toEqual(['神秘人']);
  });

  it('drops bare generic relationship and role aliases even when they appear in source text', () => {
    const aliases = sanitizeCharacterAliases('萧战', ['父亲', '族长', '萧叔叔', '萧族长', '萧叔叔他们'], {
      sourceText: '父亲皱眉。族长点头。萧叔叔说道。萧族长起身。萧叔叔他们也在。',
    });

    expect(aliases).toEqual(['萧叔叔', '萧族长']);
  });

  it('drops collective role aliases from individual characters', () => {
    const aliases = sanitizeCharacterAliases('三长老', ['三位长老', '萧家三位长老'], {
      sourceText: '三位长老对视一眼。萧家三位长老都沉默了。',
    });

    expect(aliases).toEqual([]);
  });

  it('detects collective role names that should not become characters', () => {
    expect(isCollectiveCharacterAlias('三位长老')).toBe(true);
    expect(isCollectiveCharacterAlias('萧家三位长老')).toBe(true);
    expect(isCollectiveCharacterAlias('三长老')).toBe(false);
  });

  it('drops aliases that belong to another known character', () => {
    const aliases = sanitizeCharacterAliases('萧炎', ['萧薰儿', '薰儿', '萧炎哥'], {
      sourceText: '萧炎哥说道，薰儿笑了，萧薰儿也点头。',
      knownCharacterNames: ['萧炎', '萧薰儿'],
    });

    expect(aliases).toEqual(['萧炎哥']);
  });

  it('drops a short title alias when another known character has the name-scoped title', () => {
    const aliases = sanitizeCharacterAliases('药老', ['丹王', '神秘人'], {
      sourceText: '丹王古河在加玛帝国名声极大。药老说那古河也配称作丹王？神秘人现身。',
      knownCharacterNames: ['药老', '古河'],
      knownAliasesByCharacter: {
        古河: ['丹王古河', '古河大人'],
      },
    });

    expect(aliases).toEqual(['神秘人']);
  });

  it('drops incompatible short address aliases even without seeing the other character name', () => {
    const aliases = sanitizeCharacterAliases('萧炎', ['炎儿', '薰儿', '熏儿', '薰儿小姐', '萧炎哥哥'], {
      sourceText: '炎儿回头。薰儿笑了。熏儿也笑了。薰儿小姐点头。萧炎哥哥说道。',
    });

    expect(aliases).toEqual(['炎儿', '萧炎哥哥']);
  });

  it('keeps variant spellings and short nicknames for the same character', () => {
    const aliases = sanitizeCharacterAliases('萧薰儿', ['萧熏儿', '薰儿', '熏儿'], {
      sourceText: '萧熏儿和薰儿都出现。熏儿也出现。',
      knownCharacterNames: ['萧薰儿'],
    });

    expect(aliases).toEqual(['萧熏儿', '薰儿', '熏儿']);
  });

  it('promotes a compatible full proper name over a short nickname', () => {
    expect(chooseCanonicalCharacterName('薰儿', ['薰儿小姐', '熏儿', '萧熏儿', '萧薰儿'])).toBe('萧熏儿');
  });

  it('scopes bare family relationship names to the dominant known character and drops sentence-fragment aliases', () => {
    const sourceText = [
      '路明非觉得脑袋被震得嗡嗡响。',
      '他和叔叔婶婶一起住，有一个名叫路鸣泽的堂弟。',
      '叔叔是个很讲品位的人，看见叔叔左手手机右手打火机。',
    ].join('');

    expect(chooseCanonicalCharacterName('叔叔', ['叔叔左手手机右手打火机'], {
      sourceText,
      knownCharacterNames: ['路明非', '路鸣泽'],
    } as any)).toBe('路明非的叔叔');

    expect(sanitizeCharacterAliases('路明非的叔叔', ['叔叔', '叔叔左手手机右手打火机'], {
      sourceText,
      knownCharacterNames: ['路明非', '路鸣泽'],
    })).toEqual([]);
  });

  it('normalizes compact relationship mentions to a scoped kinship name instead of the owner name', () => {
    const sourceText = '路明非叔叔坐在沙发上，叔叔左手手机右手打火机。';

    expect(chooseCanonicalCharacterName('叔叔', [], {
      sourceText,
      knownCharacterNames: ['路明非'],
    })).toBe('路明非的叔叔');
  });

  it('promotes numbered role titles to a scoped family title and removes the bare title alias', () => {
    const sourceText = '我们萧家利润损失很大。议事厅内，三长老满脸凶光，怒声道。';

    expect(chooseCanonicalCharacterName('三长老', [], { sourceText })).toBe('萧家三长老');
    expect(sanitizeCharacterAliases('萧家三长老', ['三长老'], { sourceText })).toEqual([]);
  });

  it('drops aliases containing punctuation or whitespace as narrative fragments', () => {
    const aliases = sanitizeCharacterAliases('萧炎', ['炎儿', '炎儿，', '萧炎（少年）', '炎 儿'], {
      sourceText: '炎儿回头。萧炎（少年）时期。',
    });

    expect(aliases).toEqual(['炎儿']);
  });

  it('drops over-long aliases beyond the length limit', () => {
    const aliases = sanitizeCharacterAliases('药老', ['药老哥', '深不可测的神秘药老前辈高人'], {
      sourceText: '药老哥说道。深不可测的神秘药老前辈高人现身。',
    });

    expect(aliases).not.toContain('深不可测的神秘药老前辈高人');
    expect(aliases).toContain('药老哥');
  });

  it('caps alias count keeping shorter addresses when exceeding the limit', () => {
    const many = Array.from({ length: 20 }, (_, i) => `称呼${i}号`);
    const aliases = sanitizeCharacterAliases('萧炎', [...many, '炎儿'], {
      sourceText: [...many, '炎儿'].join('。'),
    });

    expect(aliases.length).toBeLessThanOrEqual(12);
    expect(aliases).toContain('炎儿');
  });
});
