import { describe, expect, it } from 'vitest';
import { extractStoryCharacters } from './story-character-agent.js';
import type { StorySegment } from './types.js';

function storyWithSource(sourceText: string): StorySegment {
  return {
    id: 'story-appearance',
    bookId: 'book-1',
    startChapter: 1,
    endChapter: 2,
    title: '退婚冲突',
    sourceText,
    summary: '萧炎面对退婚冲突。',
    coreConflict: '萧炎必须承受退婚羞辱并重新找回尊严。',
    trigger: '纳兰嫣然提出退婚',
    turningPoints: ['退婚', '休书'],
    conflictStatus: 'ongoing',
    mainCharacters: ['萧炎'],
    supportingCharacters: ['纳兰嫣然'],
    locations: ['萧家'],
    boundaryConfidence: 0.8,
    boundaryDecisionIds: ['b-1'],
    approved: true,
  };
}

describe('extractStoryCharacters appearance fields', () => {
  it('extracts source-backed appearance evidence for a story character', () => {
    const result = extractStoryCharacters(storyWithSource([
      '萧炎身穿黑色衣衫，清秀的脸庞带着倔强，漆黑眸子里压着怒意。',
      '纳兰嫣然一身月白衣裙，容貌清丽，长发垂肩，神情平静。',
      '萧炎写下休书，厅中一片死寂。',
    ].join('\n')));

    const xiaoYan = result.characters.find((character) => character.name === '萧炎');
    const nalan = result.characters.find((character) => character.name === '纳兰嫣然');

    expect(xiaoYan?.appearanceDescription).toContain('黑色衣衫');
    expect(xiaoYan?.appearanceEvidenceSnippets).toEqual([
      '萧炎身穿黑色衣衫，',
      '清秀的脸庞带着倔强，',
      '漆黑眸子里压着怒意。',
    ]);
    expect(xiaoYan?.needsAppearanceRepair).toBe(false);
    expect(xiaoYan?.visualPrompt).toContain('黑色衣衫');

    expect(nalan?.appearanceDescription).toContain('月白衣裙');
    expect(nalan?.appearanceDescription).toContain('容貌清丽');
  });

  it('marks appearance as needing repair when no visual evidence exists', () => {
    const result = extractStoryCharacters(storyWithSource('萧炎写下休书。纳兰嫣然沉默片刻。'));
    const xiaoYan = result.characters.find((character) => character.name === '萧炎');

    expect(xiaoYan?.appearanceDescription).toBe('');
    expect(xiaoYan?.appearanceEvidenceSnippets).toEqual([]);
    expect(xiaoYan?.needsAppearanceRepair).toBe(true);
    expect(xiaoYan?.visualPrompt).toContain('外貌未被原文确认');
  });

  it('does not attach another character appearance to a mentioned target', () => {
    const result = extractStoryCharacters(storyWithSource([
      '少女顿下脚步，对着萧炎弯了弯腰，美丽的俏脸上露出清雅笑容。',
      '萧炎握紧拳头，脸庞带着倔强。',
    ].join('\n')));
    const xiaoYan = result.characters.find((character) => character.name === '萧炎');

    expect(xiaoYan?.appearanceEvidenceSnippets).toEqual([
      '脸庞带着倔强。',
    ]);
  });

  it('keeps dialogue out of extracted appearance snippets', () => {
    const result = extractStoryCharacters(storyWithSource([
      '萧炎脸庞狰狞，对着夜空咆哮道：“我草你奶奶的，把劳资穿过来当废物玩吗？”',
      '萧炎脸庞再次回复了平日的落寞。',
    ].join('\n')));
    const xiaoYan = result.characters.find((character) => character.name === '萧炎');

    expect(xiaoYan?.appearanceDescription).toContain('脸庞带有怒意');
    expect(xiaoYan?.appearanceDescription).toContain('沉静中略带落寞');
    expect(xiaoYan?.appearanceDescription).not.toContain('我草你奶奶');
    expect(xiaoYan?.visualPrompt).not.toContain('emotional context');
  });

  it('turns appearance evidence into a detailed visual breakdown', () => {
    const result = extractStoryCharacters(storyWithSource([
      '萧炎身穿黑色衣衫，清秀的脸庞带着倔强，漆黑眸子里压着怒意。',
      '少年肩背单薄，黑发束在脑后，脸色略显苍白。',
      '萧炎手指上戴着一枚古朴黑色戒指，神情沉默。',
    ].join('\n')));
    const xiaoYan = result.characters.find((character) => character.name === '萧炎');

    expect(xiaoYan?.appearanceEvidenceSnippets.length).toBeGreaterThan(3);
    expect(xiaoYan?.appearanceDescription).toContain('服装/配色：');
    expect(xiaoYan?.appearanceDescription).toContain('面部/五官：');
    expect(xiaoYan?.appearanceDescription).toContain('发型：');
    expect(xiaoYan?.appearanceDescription).toContain('体态/身形：');
    expect(xiaoYan?.appearanceDescription).toContain('肩背单薄');
    expect(xiaoYan?.appearanceDescription).toContain('黑发束在脑后');
    expect(xiaoYan?.visualPrompt).toContain('角色设定拆解');
    expect(xiaoYan?.visualPrompt).toContain('面部近景');
  });

  it('does not treat plural or other-person visual clauses as the current character', () => {
    const result = extractStoryCharacters(storyWithSource([
      '萧炎轻轻抚摸着手指中的黑色古戒。',
      '他们的身上同样穿着月白袍服，在老者的衣袍胸口处有云纹。',
      '萧炎脸庞再次回复了平日的落寞。',
    ].join('\n')));
    const xiaoYan = result.characters.find((character) => character.name === '萧炎');

    expect(xiaoYan?.appearanceDescription).toContain('黑色古戒');
    expect(xiaoYan?.appearanceDescription).toContain('沉静中略带落寞');
    expect(xiaoYan?.appearanceDescription).not.toContain('月白袍服');
    expect(xiaoYan?.appearanceDescription).not.toContain('老者的衣袍');
  });

  it('does not attach visual details of someone a character is looking at', () => {
    const result = extractStoryCharacters(storyWithSource([
      '萧炎的目光却只是在少女冷艳的小脸上停留了瞬间。',
      '萧炎脸庞再次回复了平日的落寞。',
    ].join('\n')));
    const xiaoYan = result.characters.find((character) => character.name === '萧炎');

    expect(xiaoYan?.appearanceDescription).toContain('沉静中略带落寞');
    expect(xiaoYan?.appearanceDescription).not.toContain('少女冷艳的小脸');
  });
});
