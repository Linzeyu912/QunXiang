import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const chatExtract = vi.fn();

vi.mock('@novel-agent/llm', () => ({
  getDefaultProvider: vi.fn(async () => ({ chatExtract })),
}));

describe('extractEntities', () => {
  beforeEach(() => {
    chatExtract.mockReset();
  });

  afterEach(() => {
    delete process.env.EXTRACTOR_BATCH_SIZE;
    delete process.env.EXTRACTOR_BATCH_TIMEOUT_MS;
    delete process.env.EXTRACTOR_MAX_RETRIES;
    delete process.env.EXTRACTOR_SPLIT_FAILED_BATCHES;
    vi.useRealTimers();
  });

  it('does not merge distinct proper-name characters because one alias accidentally names the other', async () => {
    const { createExtractor } = await import('./extractor.js');
    chatExtract
      .mockResolvedValueOnce({
        characters: [
          {
            name: '萧炎',
            aliases: ['萧薰儿', '薰儿', '萧炎哥'],
            description: '萧家三少爷',
            confidence: 0.99,
            firstChapter: 1,
            lastChapter: 1,
            chapterAppearances: [1],
          },
        ],
        items: [],
        locations: [],
      })
      .mockResolvedValueOnce({
        characters: [
          {
            name: '萧薰儿',
            aliases: ['萧熏儿', '薰儿', '熏儿'],
            description: '萧家少女',
            confidence: 0.95,
            firstChapter: 31,
            lastChapter: 31,
            chapterAppearances: [31],
          },
        ],
        items: [],
        locations: [],
      });

    const chapters = [
      ...Array.from({ length: 30 }, (_, index) => ({
        index: index + 1,
        content: index === 0 ? '萧炎对萧薰儿说，萧炎哥会回来。' : '萧炎修炼。',
      })),
      { index: 31, content: '萧薰儿也被称作薰儿和萧熏儿。' },
    ];

    const result = await createExtractor()('斗破苍穹', chapters);

    expect(result.characters.map((character) => character.name).sort()).toEqual(['萧炎', '萧薰儿']);
  });

  it('does not merge characters from different families that share a generic role title alias', async () => {
    const { createExtractor } = await import('./extractor.js');
    chatExtract
      .mockResolvedValueOnce({
        characters: [
          {
            name: '萧鹰',
            aliases: ['二长老', '萧鹰二长老'],
            description: '萧家二长老',
            confidence: 0.9,
            firstChapter: 1,
            lastChapter: 1,
            chapterAppearances: [1],
          },
        ],
        items: [],
        locations: [],
      })
      .mockResolvedValueOnce({
        characters: [
          {
            name: '加列怒',
            aliases: ['二长老', '加列怒长老'],
            description: '加列家族二长老',
            confidence: 0.88,
            firstChapter: 31,
            lastChapter: 31,
            chapterAppearances: [31],
          },
        ],
        items: [],
        locations: [],
      });

    const chapters = [
      ...Array.from({ length: 30 }, (_, index) => ({
        index: index + 1,
        content: index === 0 ? '萧鹰是萧家二长老。' : '萧家议事。',
      })),
      { index: 31, content: '加列怒是加列家族二长老。' },
    ];

    const result = await createExtractor()('斗破苍穹', chapters);

    expect(result.characters.map((character) => character.name).sort()).toEqual(['加列怒', '萧鹰']);
  });

  it('removes hallucinated and generic character aliases before computing signals', async () => {
    const { createExtractor } = await import('./extractor.js');
    chatExtract.mockResolvedValueOnce({
      characters: [
        {
          name: '药老',
          aliases: ['药老哥', '老师', '药老老师'],
          description: '神秘炼药师',
          confidence: 0.95,
          firstChapter: 1,
          lastChapter: 1,
          chapterAppearances: [1],
        },
        {
          name: '萧战',
          aliases: ['父亲', '族长', '萧族长'],
          description: '萧家族长',
          confidence: 0.9,
          firstChapter: 1,
          lastChapter: 1,
          chapterAppearances: [1],
        },
      ],
      items: [],
      locations: [],
    });

    const result = await createExtractor()('斗破苍穹', [
      {
        index: 1,
        content: '药老低声说。老师这个称呼很多人都会用。父亲皱眉，族长点头，萧族长起身。',
      },
    ]);

    const yaolao = result.characters.find((character) => character.name === '药老');
    const xiaozhan = result.characters.find((character) => character.name === '萧战');
    expect(yaolao?.aliases).toEqual([]);
    expect(xiaozhan?.aliases).toEqual(['萧族长']);
  });

  it('removes a title alias from the wrong character when another character owns a name-scoped form', async () => {
    const { createExtractor } = await import('./extractor.js');
    chatExtract.mockResolvedValueOnce({
      characters: [
        {
          name: '药老',
          aliases: ['丹王', '神秘人'],
          description: '神秘炼药师',
          confidence: 0.95,
          firstChapter: 1,
          lastChapter: 1,
          chapterAppearances: [1],
        },
        {
          name: '古河',
          aliases: ['丹王古河', '古河大人'],
          description: '云岚宗名誉长老',
          confidence: 0.9,
          firstChapter: 1,
          lastChapter: 1,
          chapterAppearances: [1],
        },
      ],
      items: [],
      locations: [],
    });

    const result = await createExtractor()('斗破苍穹', [
      {
        index: 1,
        content: '丹王古河在加玛帝国名声极大。药老说那古河也配称作丹王？神秘人现身。古河大人沉默。',
      },
    ]);

    const yaolao = result.characters.find((character) => character.name === '药老');
    const guhe = result.characters.find((character) => character.name === '古河');
    expect(yaolao?.aliases).toEqual(['神秘人']);
    expect(guhe?.aliases).toEqual(['丹王古河', '古河大人']);
  });

  it('drops collective role characters and aliases', async () => {
    const { createExtractor } = await import('./extractor.js');
    chatExtract.mockResolvedValueOnce({
      characters: [
        {
          name: '三长老',
          aliases: ['三位长老'],
          description: '萧家三长老',
          confidence: 0.9,
          firstChapter: 1,
          lastChapter: 1,
          chapterAppearances: [1],
        },
        {
          name: '萧家三位长老',
          aliases: ['三位长老'],
          description: '萧家长老群体',
          confidence: 0.85,
          firstChapter: 1,
          lastChapter: 1,
          chapterAppearances: [1],
        },
      ],
      items: [],
      locations: [],
    });

    const result = await createExtractor()('斗破苍穹', [
      {
        index: 1,
        content: '三长老脾气暴躁。三位长老对视一眼。萧家三位长老都沉默了。',
      },
    ]);

    expect(result.characters.map((character) => character.name)).toEqual(['三长老']);
    expect(result.characters[0].aliases).toEqual([]);
  });

  it('uses a full proper alias as the canonical character name instead of a short nickname', async () => {
    const { createExtractor } = await import('./extractor.js');
    chatExtract.mockResolvedValueOnce({
      characters: [
        {
          name: '薰儿',
          aliases: ['薰儿小姐', '熏儿', '萧熏儿', '萧薰儿'],
          description: '萧家少女',
          confidence: 0.98,
          firstChapter: 1,
          lastChapter: 1,
          chapterAppearances: [1],
        },
      ],
      items: [],
      locations: [],
    });

    const result = await createExtractor()('斗破苍穹', [
      {
        index: 1,
        content: '薰儿小姐走来。熏儿笑了。萧熏儿和萧薰儿都在原文中出现。',
      },
    ]);

    expect(result.characters[0].name).toBe('萧熏儿');
    expect(result.characters[0].aliases).toContain('薰儿');
    expect(result.characters[0].aliases).toContain('熏儿');
  });

  it('merges variant-spelling characters when the canonical name changes during merge', async () => {
    const { createExtractor } = await import('./extractor.js');
    chatExtract
      .mockResolvedValueOnce({
        characters: [
          {
            name: '萧熏儿',
            aliases: ['萧薰儿', '熏儿'],
            description: '萧家少女，与萧炎关系亲密。',
            confidence: 0.9,
            firstChapter: 1,
            lastChapter: 1,
            chapterAppearances: [1],
          },
        ],
        items: [],
        locations: [],
      })
      .mockResolvedValueOnce({
        characters: [
          {
            name: '萧薰儿',
            aliases: ['萧熏儿', '薰儿'],
            description: '背景神秘，气质淡雅。',
            confidence: 0.95,
            firstChapter: 31,
            lastChapter: 31,
            chapterAppearances: [31],
          },
        ],
        items: [],
        locations: [],
      });

    const chapters = [
      ...Array.from({ length: 30 }, (_, index) => ({
        index: index + 1,
        content: index === 0 ? '萧熏儿和萧薰儿都出现。熏儿笑了。' : '萧家众人安静看书。',
      })),
      { index: 31, content: '薰儿也被称作熏儿。' },
    ];

    const result = await createExtractor()('斗破苍穹', chapters);

    expect(result.characters).toHaveLength(1);
    expect(result.characters[0].name).toBe('萧薰儿');
    expect(result.characters[0].aliases).toContain('萧熏儿');
    expect(result.characters[0].description).toContain('萧家少女');
    expect(result.characters[0].description).toContain('背景神秘');
  });

  it('preserves complementary descriptions when the same character appears in multiple batches', async () => {
    const { createExtractor } = await import('./extractor.js');
    chatExtract
      .mockResolvedValueOnce({
        characters: [
          {
            name: '萧炎',
            aliases: ['炎儿'],
            description: '萧家三少爷，曾被视为家族天才，后来斗之气倒退。',
            confidence: 0.96,
            firstChapter: 1,
            lastChapter: 20,
            chapterAppearances: [1, 2, 3, 4, 5],
          },
        ],
        items: [],
        locations: [],
      })
      .mockResolvedValueOnce({
        characters: [
          {
            name: '萧炎',
            aliases: ['三少爷'],
            description: '身怀母亲遗留的黑色古戒，并在退婚冲突中写下休书。',
            confidence: 0.91,
            firstChapter: 21,
            lastChapter: 31,
            chapterAppearances: [21, 22, 31],
          },
        ],
        items: [],
        locations: [],
      });

    const chapters = Array.from({ length: 31 }, (_, index) => ({
      index: index + 1,
      content: index < 20
        ? '萧炎是萧家三少爷，曾被视为天才。'
        : '萧炎身怀黑色古戒，并在退婚冲突中写下休书。',
    }));

    const result = await createExtractor()('斗破苍穹', chapters);

    expect(result.characters).toHaveLength(1);
    expect(result.characters[0].description).toContain('萧家三少爷');
    expect(result.characters[0].description).toContain('黑色古戒');
    expect(result.characters[0].description).toContain('退婚冲突');
  });

  it('removes incomplete trailing description fragments during batch merge', async () => {
    const { createExtractor } = await import('./extractor.js');
    chatExtract
      .mockResolvedValueOnce({
        characters: [
          {
            name: '纳兰嫣然',
            aliases: ['嫣然'],
            description: '加玛帝国狮心元帅纳兰桀的孙女，与萧炎指腹为婚，此次奉师命前往萧家强行解除婚约，最终被萧炎以休书反将一',
            confidence: 0.9,
            firstChapter: 3,
            lastChapter: 3,
            chapterAppearances: [3],
          },
        ],
        items: [],
        locations: [],
      });

    const result = await createExtractor()('斗破苍穹', [
      {
        index: 3,
        content: '纳兰嫣然前往萧家退婚。',
      },
    ]);

    expect(result.characters[0].description).toContain('强行解除婚约');
    expect(result.characters[0].description).not.toContain('反将一');
  });

  it('marks a stuck LLM batch as failed after the configured batch timeout', async () => {
    vi.resetModules();
    process.env.EXTRACTOR_BATCH_TIMEOUT_MS = '20';
    process.env.EXTRACTOR_MAX_RETRIES = '1';
    chatExtract.mockReturnValueOnce(new Promise(() => {}));

    const { createExtractor } = await import('./extractor.js');
    const resultPromise = createExtractor()('Timeout Book', [
      { index: 1, content: 'A chapter that makes the provider hang.' },
    ]);
    const outcome = await Promise.race([
      resultPromise.then((result) => ({ kind: 'result' as const, result })),
      new Promise<{ kind: 'hung' }>((resolve) => setTimeout(() => resolve({ kind: 'hung' }), 200)),
    ]);

    expect(outcome.kind).toBe('result');
    if (outcome.kind !== 'result') return;
    expect(outcome.result.successfulBatches).toBe(0);
    expect(outcome.result.failedBatches).toHaveLength(1);
    expect(outcome.result.failedBatches[0].error).toContain('timed out');
  });

  it('splits a failed multi-chapter batch into single-chapter retries before marking it failed', async () => {
    vi.resetModules();
    process.env.EXTRACTOR_BATCH_SIZE = '2';
    process.env.EXTRACTOR_MAX_RETRIES = '1';
    chatExtract
      .mockRejectedValueOnce(new Error('non-json response'))
      .mockResolvedValueOnce({
        characters: [
          {
            name: '韩立',
            aliases: [],
            description: '七玄门弟子',
            confidence: 0.9,
            firstChapter: 1,
            lastChapter: 1,
            chapterAppearances: [1],
          },
        ],
        items: [
          {
            name: '小瓶',
            aliases: [],
            description: '韩立持有的神秘瓶子',
            confidence: 0.85,
            firstChapter: 1,
            lastChapter: 1,
            chapterAppearances: [1],
          },
        ],
        locations: [
          {
            name: '七玄门',
            aliases: [],
            description: '韩立修行所在门派',
            confidence: 0.86,
            firstChapter: 1,
            lastChapter: 1,
            chapterAppearances: [1],
          },
        ],
      })
      .mockResolvedValueOnce({
        characters: [
          {
            name: '墨大夫',
            aliases: [],
            description: '七玄门医师',
            confidence: 0.88,
            firstChapter: 2,
            lastChapter: 2,
            chapterAppearances: [2],
          },
        ],
        items: [],
        locations: [],
      });

    const { createExtractor } = await import('./extractor.js');
    const result = await createExtractor()('凡人修仙传', [
      { index: 1, content: '韩立带着小瓶进入七玄门。' },
      { index: 2, content: '墨大夫在七玄门中现身。' },
    ]);

    expect(chatExtract).toHaveBeenCalledTimes(3);
    expect(result.failedBatches).toEqual([]);
    expect(result.successfulBatches).toBe(1);
    expect(result.characters.map((character) => character.name).sort()).toEqual(['墨大夫', '韩立']);
    expect(result.items.map((item) => item.name)).toEqual(['小瓶']);
    expect(result.locations.map((location) => location.name)).toEqual(['七玄门']);
  });
});
