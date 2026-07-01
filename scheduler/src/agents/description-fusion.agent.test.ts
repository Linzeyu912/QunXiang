import { beforeEach, describe, expect, it, vi } from 'vitest';

const chatExtract = vi.fn();

vi.mock('@novel-agent/llm', () => ({
  getDefaultProvider: vi.fn(async () => ({ chatExtract })),
}));

describe('executeDescriptionFusion', () => {
  beforeEach(() => {
    chatExtract.mockReset();
  });

  it('uses an LLM pass to fuse repeated batch descriptions into one coherent character intro', async () => {
    const { executeDescriptionFusion } = await import('./description-fusion.agent.js');
    chatExtract.mockResolvedValueOnce({
      characters: [
        {
          name: '萧炎',
          description:
            '萧家三少爷，萧战之子，曾因修炼停滞被视为废物，后来跟随药老修炼并在成人仪式前重回七段斗之气。',
        },
      ],
      items: [],
      locations: [],
    });

    const result = await executeDescriptionFusion({
      characters: [
        {
          name: '萧炎',
          aliases: ['炎儿'],
          description:
            '主角，萧家三少爷；萧家三少爷，族长之子，曾因修炼停滞三年被嘲讽为废物；主角，跟随药老修炼，在成人仪式前重回七段斗之气。',
          confidence: 0.95,
          status: 'PENDING',
          firstChapter: 1,
          lastChapter: 30,
          chapterAppearances: [1, 2, 3, 30],
          mentionCount: 120,
          dialogueCount: 10,
          coCharacters: ['药老'],
        },
      ],
      items: [],
      locations: [],
    });

    expect(result.characters[0].description).toBe(
      '萧家三少爷，萧战之子，曾因修炼停滞被视为废物，后来跟随药老修炼并在成人仪式前重回七段斗之气'
    );
    expect(result.characters[0].aliases).toEqual(['炎儿']);
    expect(chatExtract).toHaveBeenCalledTimes(1);
    const [systemPrompt, userPrompt] = chatExtract.mock.calls[0];
    expect(systemPrompt).toContain('根据原文概括');
    expect(systemPrompt).toContain('不要乱补');
    expect(systemPrompt).toContain('不要省略');
    expect(systemPrompt).toContain('真实动作主体');
    expect(userPrompt).toContain('主角，萧家三少爷');
  });

  it('deduplicates alias-equivalent characters before fusing descriptions', async () => {
    const { executeDescriptionFusion } = await import('./description-fusion.agent.js');
    chatExtract.mockResolvedValueOnce({
      characters: [
        {
          name: '萧薰儿',
          description: '萧家少女，与萧炎关系亲密，背景神秘，容貌清雅如青莲。',
        },
      ],
      items: [],
      locations: [],
    });

    const base = {
      confidence: 0.9,
      status: 'PENDING' as const,
      firstChapter: 1,
      lastChapter: 76,
      chapterAppearances: [1, 76],
      mentionCount: 10,
      dialogueCount: 0,
      coCharacters: ['萧炎'],
    };

    const result = await executeDescriptionFusion({
      characters: [
        {
          ...base,
          name: '萧熏儿',
          aliases: ['萧薰儿', '熏儿'],
          description: '萧家少女，与萧炎关系亲密；背景神秘',
        },
        {
          ...base,
          name: '萧薰儿',
          aliases: ['萧熏儿', '薰儿'],
          description: '容貌清雅如青莲；性子淡雅',
          confidence: 0.95,
        },
      ],
      items: [],
      locations: [],
    });

    expect(result.characters).toHaveLength(1);
    expect(result.characters[0].name).toBe('萧薰儿');
    expect(result.characters[0].aliases).toContain('萧熏儿');
    expect(result.characters[0].description).toBe('萧家少女，与萧炎关系亲密，背景神秘，容貌清雅如青莲');
  });

  it('keeps fallback descriptions when an LLM fusion group fails', async () => {
    const { executeDescriptionFusion } = await import('./description-fusion.agent.js');
    chatExtract.mockRejectedValueOnce(new Error('fusion timeout'));

    const result = await executeDescriptionFusion({
      characters: [
        {
          name: 'Han Li',
          aliases: [],
          description: 'young cultivator; cautious mountain youth',
          confidence: 0.9,
          status: 'PENDING',
          chapterAppearances: [1],
          mentionCount: 20,
          dialogueCount: 2,
          coCharacters: [],
        },
      ],
      items: [],
      locations: [],
    });

    expect(result.characters[0].description).toBe('young cultivator；cautious mountain youth');
    expect(result.descriptionFusion).toEqual({ requested: 1, fused: 0, skipped: 1 });
  });

  it('compresses repeated protagonist labels in fallback descriptions when LLM fusion fails', async () => {
    const { executeDescriptionFusion } = await import('./description-fusion.agent.js');
    chatExtract.mockRejectedValueOnce(new Error('fusion timeout'));

    const originalDescription = [
      '主角，村里人称二愣子，皮肤黝黑，进入七玄门参加入门考验',
      '主角，墨大夫的亲传弟子，在神手谷修炼长春功并暗中提防师父',
      '主角，修炼长春功至第六层，掌握罗烟步、敛息功和伪匿术',
      '本书主角，离开七玄门前往岚州解毒，并寻找真正的修仙者',
    ].join('；');

    const result = await executeDescriptionFusion({
      characters: [
        {
          name: '韩立',
          aliases: ['小立'],
          description: originalDescription,
          confidence: 0.99,
          status: 'PENDING',
          chapterAppearances: [1, 20, 60, 100],
          mentionCount: 300,
          dialogueCount: 40,
          coCharacters: [],
        },
      ],
      items: [],
      locations: [],
    });

    const description = result.characters[0].description || '';
    expect((description.match(/主角/gu) || [])).toHaveLength(1);
    expect(description.length).toBeLessThan(originalDescription.length);
    expect(description).toContain('墨大夫的亲传弟子');
    expect(description).toContain('前往岚州解毒');
  });

  it('applies LLM fused descriptions when returned names have harmless whitespace', async () => {
    const { executeDescriptionFusion } = await import('./description-fusion.agent.js');
    chatExtract.mockResolvedValueOnce({
      characters: [{
        name: ' 韩立 ',
        description: '韩立是出身乡村的谨慎少年，在七玄门修炼长春功并逐步接触修仙世界。',
      }],
      items: [],
      locations: [],
    });

    const result = await executeDescriptionFusion({
      characters: [
        {
          name: '韩立',
          aliases: [],
          description: '主角，出身乡村；主角，在七玄门修炼长春功',
          confidence: 0.99,
          status: 'PENDING',
          chapterAppearances: [1],
          mentionCount: 50,
          dialogueCount: 5,
          coCharacters: [],
        },
      ],
      items: [],
      locations: [],
    });

    expect(result.characters[0].description).toBe('韩立是出身乡村的谨慎少年，在七玄门修炼长春功并逐步接触修仙世界');
    expect(result.descriptionFusion).toEqual({ requested: 1, fused: 1, skipped: 0 });
  });

  it('removes generic aliases and aliases that collide with another same-kind entity', async () => {
    const { executeDescriptionFusion } = await import('./description-fusion.agent.js');

    const locationBase = {
      confidence: 0.95,
      status: 'PENDING' as const,
      chapterAppearances: [1],
      importanceScore: 0.8,
      tier: 'core' as const,
      storyScore: 2,
      productionScore: 0.7,
      pillarCausal: 0.7,
      pillarUniqueness: 0.5,
      pillarTransition: 0.6,
      mentionCount: 6,
    };

    const result = await executeDescriptionFusion({
      characters: [],
      items: [],
      locations: [
        {
          ...locationBase,
          name: '太南谷',
          aliases: ['神手谷', '山谷', '谷内', '太南谷', '太南会'],
          description: '修仙者聚会之地。',
        },
        {
          ...locationBase,
          name: '神手谷',
          aliases: [],
          description: '韩立修炼所在山谷。',
        },
      ],
    });

    expect(result.locations.find((location) => location.name === '太南谷')?.aliases).toEqual(['太南会']);
    expect(chatExtract).not.toHaveBeenCalled();
  });
});
