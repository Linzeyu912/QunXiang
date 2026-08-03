import { beforeEach, describe, expect, it, vi } from 'vitest';

const chatExtract = vi.fn();

vi.mock('@novel-agent/llm', () => ({
  getDefaultProvider: vi.fn(async () => ({ chatExtract })),
}));

/**
 * 验证曲魂场景：source fields 是叙述性原文碎片（"因为他看到巨汉…"），
 * 修改后 LLM 应清洗为纯视觉描述，enhancedDescription 不再是原文拼接。
 */
describe('executeVisualDescription — 叙述性 source field 清洗', () => {
  beforeEach(() => {
    chatExtract.mockReset();
  });

  it('清洗含叙述性内容的 source fields，enhancedDescription 不含原文叙述碎片', async () => {
    const { executeVisualDescription } = await import('./visual-description.agent.js');

    // 模拟 LLM 返回清洗后的纯视觉描述
    chatExtract.mockResolvedValueOnce({
      characters: [{
        name: '曲魂',
        visualFields: {
          appearance: '面容酷似张铁，略显丑陋',
          clothing: '头戴斗篷，身穿绿袍',
          body: '身形异常高大魁梧，远超常人',
          temperament: '神情木讷，目光空洞',
          signatureItems: '无',
          abilityVisuals: '',
          statusMarkers: '',
        },
        visualDetails: {
          bodyBuild: '身形异常高大，比普通人高出两头还多，体型魁梧',
          faceShape: '面容酷似张铁，原本略显丑陋',
          temperament: '神情木讷，目光空洞，机械顺从',
          eyes: '两眼无神',
          skin: '皮肤坚硬如铁，泛有不自然的灰青色',
        },
        enhancedDescription: '身形异常高大的魁梧巨汉，比常人高出两头有余。面容酷似张铁，略显丑陋但轮廓分明。两眼无神，神情木讷，目光空洞，机械顺从。皮肤坚硬如铁，泛着不自然的灰青色。头戴斗篷遮住面目，身穿绿袍。',
        llmSupplement: '',
      }],
      items: [],
      locations: [],
    });

    // 曲魂的真实 source data（含大量叙述性原文碎片）
    const result = await executeVisualDescription({
      characters: [{
        name: '曲魂',
        aliases: ['巨汉', '铁奴'],
        description: '原为韩立好友张铁的躯体，被炼尸术抹去魂魄催成巨汉。',
        confidence: 0.95,
        status: 'PENDING',
        tier: 'supporting',
        chapterAppearances: [51, 63, 100],
        mentionCount: 149,
        dialogueCount: 0,
        coCharacters: [],
      }],
      items: [],
      locations: [],
      characterDescriptions: [{
        entityType: 'character',
        name: '曲魂',
        aliases: ['巨汉'],
        sourceDescription: '因为身形过于引人注意；身材高大异常',
        fields: {
          // 这些都是叙述性原文碎片，不是纯视觉描述
          appearance: '因为他看到巨汉一改刚才的死板面孔；原本觉得有些过于丑陋的面孔',
          clothing: '除了那个蓝衣服的人活捉外；里面除了一些换洗的衣服外；身穿绿袍',
          body: '因为身形过于引人注意；身材高大异常；一个身材完全不下去曲魂的魁梧巨汉；但是等看清楚巨汉远超常人的身材后',
          temperament: '他的神情显得木讷；此时的他那里还看得出一丝的冷漠和无情',
          signatureItems: '一把尖刀和一根粗粗的铁棒',
          abilityVisuals: '功法已到了某颈',
          statusMarkers: '多半是某个土财主家的少爷',
        },
        missingFields: [],
        evidenceSnippets: [{
          chapterIndex: 63,
          text: '巨汉睁开了双眼，缓缓的站了起来，他的神情显得木讷。',
          matchedNames: ['巨汉'],
          fields: ['temperament'],
        }],
        sourceCoverage: 'strong',
        confidence: 0.95,
        needsReview: false,
      }],
    });

    const pack = result.characterVisualDescriptions[0];

    // 1. visualFields 应该用 LLM 清洗版，而非原文碎片
    expect(pack.visualFields.appearance).toBe('面容酷似张铁，略显丑陋');
    expect(pack.visualFields.clothing).toBe('头戴斗篷，身穿绿袍');
    expect(pack.visualFields.body).toBe('身形异常高大魁梧，远超常人');
    // 不应保留叙述性原文
    expect(pack.visualFields.appearance).not.toContain('因为他看到');
    expect(pack.visualFields.body).not.toContain('因为身形过于');
    expect(pack.visualFields.clothing).not.toContain('除了那个蓝衣服');

    // 2. enhancedDescription 应该是 LLM 生成的视觉概括，而非原文拼接
    expect(pack.enhancedDescription).toContain('身形异常高大的魁梧巨汉');
    expect(pack.enhancedDescription).not.toContain('因为他看到巨汉');
    expect(pack.enhancedDescription).not.toContain('因为身形过于引人注意');
    expect(pack.enhancedDescription).not.toContain('除了那个蓝衣服的人活捉外');

    // 3. 叙述性字段被标记为 summarized（已清洗）
    expect(pack.summarizedFields).toContain('appearance');
    expect(pack.summarizedFields).toContain('clothing');
    expect(pack.summarizedFields).toContain('body');
    expect(pack.summarizedFields).toContain('temperament');
  });

  it('fallback 分支也过滤叙述性原文，不拼入 enhancedDescription', async () => {
    const { executeVisualDescription } = await import('./visual-description.agent.js');

    // LLM 返回空 enhancedDescription（触发 fallback），但有 visualDetails
    chatExtract.mockResolvedValueOnce({
      characters: [{
        name: '曲魂',
        visualFields: {
          appearance: '',  // LLM 没清洗这个字段
          clothing: '头戴斗篷，身穿绿袍',
          body: '',
          temperament: '神情木讷，目光空洞',
          signatureItems: '一把尖刀和一根粗粗的铁棒',
          abilityVisuals: '',
          statusMarkers: '',
        },
        visualDetails: {
          bodyBuild: '身形异常高大，比普通人高出两头还多',
          faceShape: '面容酷似张铁',
          temperament: '神情木讷，机械顺从',
          eyes: '两眼无神',
          skin: '皮肤坚硬如铁，泛灰青色',
        },
        enhancedDescription: '',  // 空，触发 fallback
        llmSupplement: '',
      }],
      items: [],
      locations: [],
    });

    const result = await executeVisualDescription({
      characters: [{
        name: '曲魂',
        aliases: ['巨汉'],
        description: '炼尸术催成的巨汉。',
        confidence: 0.95,
        status: 'PENDING',
        tier: 'supporting',
        chapterAppearances: [51, 63],
        mentionCount: 149,
        dialogueCount: 0,
        coCharacters: [],
      }],
      items: [],
      locations: [],
      characterDescriptions: [{
        entityType: 'character',
        name: '曲魂',
        aliases: ['巨汉'],
        sourceDescription: '因为身形过于引人注意',
        fields: {
          // appearance/body 没被 LLM 清洗（LLM 返回空），保留 source 原文
          appearance: '因为他看到巨汉一改刚才的死板面孔；原本觉得有些过于丑陋的面孔',
          clothing: '',  // source 空，LLM 填了
          body: '因为身形过于引人注意；身材高大异常',
          temperament: '',  // source 空，LLM 填了
          signatureItems: '',  // source 空，LLM 填了
          abilityVisuals: '',
          statusMarkers: '',
        },
        missingFields: ['clothing', 'temperament', 'signatureItems', 'abilityVisuals', 'statusMarkers'],
        evidenceSnippets: [],
        sourceCoverage: 'partial',
        confidence: 0.5,
        needsReview: true,
      }],
    });

    const pack = result.characterVisualDescriptions[0];

    // fallback 拼接的 enhancedDescription 不应含叙述性原文
    expect(pack.enhancedDescription).not.toContain('因为他看到');
    expect(pack.enhancedDescription).not.toContain('因为身形过于');
    expect(pack.enhancedDescription).not.toContain('原本觉得');

    // 但应包含 LLM 清洗后的视觉描述和 visualDetails
    expect(pack.enhancedDescription).toContain('头戴斗篷');
    expect(pack.enhancedDescription).toContain('神情木讷');
    // visualDetails 也应织入
    expect(pack.enhancedDescription).toContain('身形异常高大');
  });
});
