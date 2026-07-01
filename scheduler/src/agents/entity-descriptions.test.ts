import { describe, expect, it } from 'vitest';
import {
  extractCharacterDescriptionPacks,
  extractItemDescriptionPacks,
  extractLocationDescriptionPacks,
} from './entity-descriptions.js';

describe('extractCharacterDescriptionPacks', () => {
  it('extracts source-backed character visual fields without inventing missing details', () => {
    const packs = extractCharacterDescriptionPacks(
      [{
        name: '萧炎',
        aliases: ['炎儿'],
        description: '萧家三少爷。',
        confidence: 0.92,
        status: 'PENDING',
        firstChapter: 1,
        lastChapter: 2,
        chapterAppearances: [1, 2],
        mentionCount: 10,
        dialogueCount: 2,
        coCharacters: [],
      }],
      [
        {
          index: 1,
          title: '陨落的天才',
          content: '萧炎身穿黑色衣衫，清秀的脸庞带着倔强，手指上戴着一枚古朴黑色戒指。',
        },
        {
          index: 2,
          title: '退婚',
          content: '炎儿站在大厅中，神情落寞，却仍写下休书。萧炎体内斗气翻涌。',
        },
      ]
    );

    expect(packs).toHaveLength(1);
    expect(packs[0]).toMatchObject({
      entityType: 'character',
      name: '萧炎',
      aliases: ['炎儿'],
      sourceCoverage: 'strong',
      needsReview: false,
    });
    expect(packs[0].fields.clothing).toContain('黑色衣衫');
    expect(packs[0].fields.appearance).toContain('清秀的脸庞带着倔强');
    expect(packs[0].fields.temperament).toContain('神情落寞');
    expect(packs[0].fields.signatureItems).toContain('古朴黑色戒指');
    expect(packs[0].fields.abilityVisuals).toContain('斗气翻涌');
    expect(packs[0].sourceDescription).toContain('黑色衣衫');
    expect(packs[0].sourceDescription).toContain('斗气翻涌');
    expect([...new Set(packs[0].evidenceSnippets.map((evidence) => evidence.chapterIndex))]).toEqual([1, 2]);
    expect(packs[0].missingFields).toContain('body');
    expect(packs[0].sourceDescription).not.toContain('黑发');
  });

  it('marks source coverage as none when the original text has no descriptive evidence', () => {
    const packs = extractCharacterDescriptionPacks(
      [{
        name: '纳兰嫣然',
        aliases: [],
        description: '云岚宗弟子。',
        confidence: 0.8,
        status: 'PENDING',
        chapterAppearances: [1],
        mentionCount: 3,
        dialogueCount: 0,
        coCharacters: [],
      }],
      [{ index: 1, content: '纳兰嫣然说道：“今日前来，是为退婚。”' }]
    );

    expect(packs[0].sourceDescription).toBe('');
    expect(packs[0].evidenceSnippets).toEqual([]);
    expect(packs[0].sourceCoverage).toBe('none');
    expect(packs[0].needsReview).toBe(true);
    expect(packs[0].missingFields).toEqual([
      'appearance',
      'clothing',
      'body',
      'temperament',
      'signatureItems',
      'abilityVisuals',
      'statusMarkers',
    ]);
  });

  it('does not assign another named character appearance clause to the current character', () => {
    const packs = extractCharacterDescriptionPacks(
      [
        {
          name: '萧炎',
          aliases: [],
          description: '萧家少年。',
          confidence: 0.9,
          status: 'PENDING',
          chapterAppearances: [1],
          mentionCount: 5,
          dialogueCount: 0,
          coCharacters: ['薰儿'],
        },
        {
          name: '薰儿',
          aliases: [],
          description: '萧家少女。',
          confidence: 0.9,
          status: 'PENDING',
          chapterAppearances: [1],
          mentionCount: 5,
          dialogueCount: 0,
          coCharacters: ['萧炎'],
        },
      ],
      [{
        index: 1,
        content: '萧炎摸了摸鼻子，薰儿俏脸微红，萧炎身穿黑色衣衫。',
      }]
    );

    const xiaoYan = packs.find((pack) => pack.name === '萧炎');
    expect(xiaoYan?.fields.appearance).not.toContain('薰儿俏脸微红');
    expect(xiaoYan?.fields.clothing).toContain('萧炎身穿黑色衣衫');
  });

  it('does not inherit unnamed descriptive clauses from another character in the same sentence', () => {
    const packs = extractCharacterDescriptionPacks(
      [
        {
          name: '萧炎',
          aliases: [],
          description: '萧家少年。',
          confidence: 0.9,
          status: 'PENDING',
          chapterAppearances: [1],
          mentionCount: 5,
          dialogueCount: 0,
          coCharacters: ['萧熏儿'],
        },
        {
          name: '萧熏儿',
          aliases: ['熏儿'],
          description: '萧家少女。',
          confidence: 0.9,
          status: 'PENDING',
          chapterAppearances: [1],
          mentionCount: 5,
          dialogueCount: 0,
          coCharacters: ['萧炎'],
        },
      ],
      [{
        index: 1,
        content: '在大厅角落，萧熏儿微笑着合拢书籍，气质淡雅从容，对着萧炎眨了眨眼睛。萧炎身穿黑色衣衫，清秀脸庞带着倔强。',
      }]
    );

    const xiaoYan = packs.find((pack) => pack.name === '萧炎');
    const xunEr = packs.find((pack) => pack.name === '萧熏儿');
    expect(xiaoYan?.fields.temperament).not.toContain('气质淡雅从容');
    expect(xiaoYan?.fields.clothing).toContain('萧炎身穿黑色衣衫');
    expect(xiaoYan?.fields.appearance).toContain('清秀脸庞带着倔强');
    expect(xunEr?.fields.temperament).toContain('气质淡雅从容');
  });

  it('does not treat a character observing someone else as the observed appearance', () => {
    const packs = extractCharacterDescriptionPacks(
      [{
        name: '韩立',
        aliases: [],
        description: '七玄门弟子。',
        confidence: 0.95,
        status: 'PENDING',
        chapterAppearances: [1],
        mentionCount: 20,
        dialogueCount: 0,
        coCharacters: [],
      }],
      [{
        index: 1,
        content: '韩立刚看清此女的面容，那晶莹似雪的肌肤和挺直小巧的琼鼻十分醒目。韩立皮肤黝黑，神色平静。',
      }]
    );

    const hanLi = packs[0];
    expect(hanLi.fields.appearance).toContain('韩立皮肤黝黑');
    expect(hanLi.fields.appearance).not.toContain('此女的面容');
    expect(hanLi.fields.appearance).not.toContain('晶莹似雪');
    expect(hanLi.fields.temperament).toContain('神色平静');
  });

  it('extracts source-backed item visual fields without mixing other props', () => {
    const packs = extractItemDescriptionPacks(
      [{
        name: '青木剑',
        aliases: [],
        description: '退婚冲突中出现的剑。',
        confidence: 0.82,
        status: 'PENDING',
        importanceScore: 0.7,
        tier: 'supporting',
        storyScore: 0.7,
        productionScore: 0.6,
        pillarCausal: 0.5,
        pillarUniqueness: 0.5,
        pillarTransition: 0.4,
        mentionCount: 2,
        firstChapter: 3,
        lastChapter: 3,
        chapterAppearances: [3],
      }],
      [
        {
          index: 3,
          content: '萧炎手中的青木剑通体青色，剑身细长，由坚硬青木打造，表面泛着淡淡青芒。纳兰嫣然取出一枚古朴玉佩，玉佩边缘已有细小裂纹。',
        },
      ]
    );

    expect(packs).toHaveLength(1);
    expect(packs[0]).toMatchObject({
      entityType: 'item',
      name: '青木剑',
      sourceCoverage: 'partial',
      needsReview: true,
    });
    expect(packs[0].fields.material).toContain('坚硬青木');
    expect(packs[0].fields.colorShape).toContain('通体青色');
    expect(packs[0].fields.colorShape).toContain('剑身细长');
    expect(packs[0].fields.visualEffects).toContain('淡淡青芒');
    expect(packs[0].fields.ownership).toContain('萧炎手中的青木剑');
    expect(packs[0].sourceDescription).not.toContain('玉佩');
    expect(packs[0].missingFields).toContain('condition');
  });

  it('extracts source-backed location scene fields for later visual use', () => {
    const packs = extractLocationDescriptionPacks(
      [{
        name: '乌坦城大厅',
        aliases: ['大厅'],
        description: '萧家处理退婚冲突的场所。',
        confidence: 0.86,
        status: 'PENDING',
        importanceScore: 0.8,
        tier: 'core',
        storyScore: 0.8,
        productionScore: 0.7,
        pillarCausal: 0.7,
        pillarUniqueness: 0.5,
        pillarTransition: 0.6,
        mentionCount: 4,
        firstChapter: 3,
        lastChapter: 3,
        chapterAppearances: [3],
      }],
      [
        {
          index: 3,
          title: '退婚',
          content: '乌坦城大厅灯火明亮，中央摆着石桌，两侧坐满萧家族人，气氛压抑。夜色从门外落进来，萧炎与纳兰嫣然在大厅中对峙。云岚宗山门云雾缭绕。',
        },
      ]
    );

    expect(packs).toHaveLength(1);
    expect(packs[0]).toMatchObject({
      entityType: 'location',
      name: '乌坦城大厅',
      sourceCoverage: 'strong',
      needsReview: false,
    });
    expect(packs[0].fields.environment).toContain('乌坦城大厅');
    expect(packs[0].fields.layout).toContain('中央摆着石桌');
    expect(packs[0].fields.atmosphere).toContain('气氛压抑');
    expect(packs[0].fields.lighting).toContain('灯火明亮');
    expect(packs[0].fields.time).toContain('夜色从门外落进来');
    expect(packs[0].fields.actionContext).toContain('大厅中对峙');
    expect(packs[0].sourceDescription).not.toContain('云岚宗山门');
  });

  it('does not use generic or cross-entity aliases when extracting location descriptions', () => {
    const packs = extractLocationDescriptionPacks(
      [
        {
          name: '太南谷',
          aliases: ['神手谷', '山谷', '谷内'],
          description: '修仙者聚会之地。',
          confidence: 0.95,
          status: 'PENDING',
          importanceScore: 0.8,
          tier: 'core',
          storyScore: 2,
          productionScore: 0.7,
          pillarCausal: 0.7,
          pillarUniqueness: 0.5,
          pillarTransition: 0.6,
          mentionCount: 6,
          firstChapter: 1,
          lastChapter: 1,
          chapterAppearances: [1],
        },
        {
          name: '神手谷',
          aliases: [],
          description: '韩立修炼所在山谷。',
          confidence: 0.95,
          status: 'PENDING',
          importanceScore: 0.8,
          tier: 'core',
          storyScore: 2,
          productionScore: 0.7,
          pillarCausal: 0.7,
          pillarUniqueness: 0.5,
          pillarTransition: 0.6,
          mentionCount: 10,
          firstChapter: 1,
          lastChapter: 1,
          chapterAppearances: [1],
        },
      ],
      [{
        index: 1,
        content: '神手谷石屋灯火明亮，四周墙壁封闭。太南谷是一个翠绿色山谷，谷中种满奇花异草。',
      }]
    );

    const taiNan = packs.find((pack) => pack.name === '太南谷');
    expect(taiNan?.sourceDescription).toContain('翠绿色山谷');
    expect(taiNan?.sourceDescription).not.toContain('神手谷石屋');
    expect(taiNan?.sourceDescription).not.toContain('灯火明亮');
  });
});
