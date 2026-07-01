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
});
