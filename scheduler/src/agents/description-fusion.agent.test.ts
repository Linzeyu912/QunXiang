import { beforeEach, describe, expect, it, vi } from 'vitest';

const chatExtract = vi.fn();

vi.mock('@qunxiang/llm', () => ({
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

    expect(result.characters).toHaveLength(2);
    expect(result.characters.map((character) => character.name).sort()).toEqual(['萧熏儿', '萧薰儿']);
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

  it('retries once when a solo-entity fusion call fails before falling back', async () => {
    const { executeDescriptionFusion } = await import('./description-fusion.agent.js');
    // 超长实体单独成组：首次失败 → 重试一次成功
    const longDescription = Array.from({ length: 40 }, (_, i) => `第${i}批：韩立在七玄门修炼并发现神秘小瓶`).join('；');
    chatExtract
      .mockRejectedValueOnce(new Error('solo timeout'))
      .mockResolvedValueOnce({
        characters: [{ name: '韩立', description: '谨慎机敏的乡村少年，七玄门神手谷弟子，拥有神秘小瓶。' }],
        items: [],
        locations: [],
      });

    const result = await executeDescriptionFusion({
      characters: [
        {
          name: '韩立',
          aliases: [],
          description: longDescription,
          confidence: 0.99,
          status: 'PENDING',
          chapterAppearances: [1],
          mentionCount: 3000,
          dialogueCount: 30,
          coCharacters: [],
        },
      ],
      items: [],
      locations: [],
    });

    expect(result.characters[0].description).toContain('谨慎机敏的乡村少年');
    expect(result.descriptionFusion).toEqual({ requested: 1, fused: 1, skipped: 0 });
    expect(chatExtract).toHaveBeenCalledTimes(2);
  });

  it('splits and retries when a multi-entity fusion group fails once', async () => {
    const { executeDescriptionFusion } = await import('./description-fusion.agent.js');
    // 第一次整组失败 → 拆半成两个单实体组 → 各自成功
    chatExtract
      .mockRejectedValueOnce(new Error('output truncated'))
      .mockResolvedValueOnce({
        characters: [{ name: '韩立', description: '谨慎的乡村少年，七玄门神手谷弟子，修炼无名口诀，拥有神秘小瓶。' }],
        items: [],
        locations: [],
      })
      .mockResolvedValueOnce({
        characters: [{ name: '墨大夫', description: '七玄门供奉，医术高深，收韩立为亲传弟子。' }],
        items: [],
        locations: [],
      });

    const base = {
      confidence: 0.95,
      status: 'PENDING' as const,
      firstChapter: 1,
      lastChapter: 100,
      chapterAppearances: [1, 100],
      mentionCount: 200,
      dialogueCount: 20,
      coCharacters: [],
    };
    const result = await executeDescriptionFusion({
      characters: [
        { ...base, name: '韩立', aliases: [], description: '主角，乡村少年；主角，七玄门弟子；主角，拥有神秘小瓶' },
        { ...base, name: '墨大夫', aliases: [], description: '七玄门供奉，医术高深；神手谷主人，收韩立为徒' },
      ],
      items: [],
      locations: [],
    });

    expect(result.characters.find((c) => c.name === '韩立')?.description).toContain('谨慎的乡村少年');
    expect(result.characters.find((c) => c.name === '墨大夫')?.description).toContain('七玄门供奉');
    expect(result.descriptionFusion).toEqual({ requested: 2, fused: 2, skipped: 0 });
    expect(chatExtract).toHaveBeenCalledTimes(3);
  });

  it('retries only the entities an LLM response missed instead of the whole group', async () => {
    const { executeDescriptionFusion } = await import('./description-fusion.agent.js');
    // 第一次调用只返回了韩立，漏掉墨大夫 → 仅对墨大夫重试
    chatExtract
      .mockResolvedValueOnce({
        characters: [{ name: '韩立', description: '谨慎的乡村少年，七玄门弟子。' }],
        items: [],
        locations: [],
      })
      .mockResolvedValueOnce({
        characters: [{ name: '墨大夫', description: '七玄门供奉，神手谷主人。' }],
        items: [],
        locations: [],
      });

    const base = {
      confidence: 0.95,
      status: 'PENDING' as const,
      firstChapter: 1,
      lastChapter: 100,
      chapterAppearances: [1, 100],
      mentionCount: 200,
      dialogueCount: 20,
      coCharacters: [],
    };
    const result = await executeDescriptionFusion({
      characters: [
        { ...base, name: '韩立', aliases: [], description: '主角，乡村少年；主角，七玄门弟子' },
        { ...base, name: '墨大夫', aliases: [], description: '七玄门供奉；神手谷主人' },
      ],
      items: [],
      locations: [],
    });

    expect(result.characters.find((c) => c.name === '韩立')?.description).toContain('谨慎的乡村少年');
    expect(result.characters.find((c) => c.name === '墨大夫')?.description).toContain('神手谷主人');
    expect(result.descriptionFusion).toEqual({ requested: 2, fused: 2, skipped: 0 });
    expect(chatExtract).toHaveBeenCalledTimes(2);
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

  it('removes noisy sentence-fragment aliases from locations and items', async () => {
    const { executeDescriptionFusion } = await import('./description-fusion.agent.js');

    const base = {
      confidence: 0.9,
      status: 'PENDING' as const,
      chapterAppearances: [1],
      importanceScore: 0.6,
      tier: 'supporting' as const,
      storyScore: 1,
      productionScore: 0.5,
      pillarCausal: 0.4,
      pillarUniqueness: 0.4,
      pillarTransition: 0.3,
      mentionCount: 2,
    };

    const result = await executeDescriptionFusion({
      characters: [],
      items: [
        {
          ...base,
          name: '纯黑色N96手机',
          aliases: ['N96', '叔叔左手手机右手打火机', '手机右手打火机', '纯黑色N96手机'],
          description: '路明非收到的手机。',
          owners: [],
        },
      ],
      locations: [
        {
          ...base,
          name: '放映厅',
          aliases: ['这里', '放映厅大门走去', '放映厅'],
          description: '文学社聚会所在场地。',
        },
      ],
    });

    expect(result.items[0].aliases).toEqual(['N96']);
    expect(result.locations[0].aliases).toEqual([]);
    expect(chatExtract).not.toHaveBeenCalled();
  });
});
