import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CharacterDescriptionPack, ItemDescriptionPack, LocationDescriptionPack } from './entity-descriptions.js';

const chatExtract = vi.fn();
const isConfigured = vi.fn(async () => true);

vi.mock('@qunxiang/llm', () => ({
  getDefaultProvider: vi.fn(async () => ({ chatExtract, isConfigured })),
}));

describe('executeResolution', () => {
  beforeEach(() => {
    chatExtract.mockReset();
    isConfigured.mockClear();
    isConfigured.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const baseCharacter = (overrides: Partial<Record<string, unknown>>) => ({
    name: '',
    aliases: [] as string[],
    description: '',
    confidence: 0.8,
    status: 'PENDING' as const,
    chapterAppearances: [1],
    mentionCount: 1,
    dialogueCount: 0,
    coCharacters: [] as string[],
    ...overrides,
  });

  it('passes character description packs through after entity resolution', async () => {
    const { executeResolution } = await import('./resolution.agent.js');
    const characterDescriptions: CharacterDescriptionPack[] = [{
      entityType: 'character',
      name: '萧炎',
      aliases: [],
      sourceDescription: '萧炎身穿黑色衣衫。',
      fields: {
        appearance: '',
        clothing: '萧炎身穿黑色衣衫',
        body: '',
        temperament: '',
        signatureItems: '',
        abilityVisuals: '',
        statusMarkers: '',
      },
      missingFields: ['appearance', 'body', 'temperament', 'signatureItems', 'abilityVisuals', 'statusMarkers'],
      evidenceSnippets: [{
        chapterIndex: 1,
        text: '萧炎身穿黑色衣衫。',
        matchedNames: ['萧炎'],
        fields: ['clothing'],
      }],
      sourceCoverage: 'partial',
      confidence: 0.28,
      needsReview: true,
    }];

    const result = await executeResolution({
      characters: [baseCharacter({ name: '萧炎', description: '萧家三少爷', mentionCount: 2 })],
      locations: [],
      items: [],
      characterDescriptions,
    });

    expect(result.characterDescriptions).toEqual(characterDescriptions);
    expect(result.llmFusion).toMatchObject({ judged: 0, merged: 0 });
  });

  it('LLM 整单消歧：称谓变体分为一组且高置信 → 自动合并（提及多者为主，计数相加）', async () => {
    const { executeResolution } = await import('./resolution.agent.js');
    chatExtract.mockResolvedValue({
      groups: [{ indices: [0, 1], confidence: 0.92, reason: '称谓变体' }],
    });

    const result = await executeResolution({
      characters: [
        baseCharacter({ name: '古德里安', description: '卡塞尔学院教授', mentionCount: 120, chapterAppearances: [1, 2, 3] }),
        baseCharacter({ name: '古德里安教授', description: '面试官', mentionCount: 5, chapterAppearances: [2] }),
      ],
      locations: [],
      items: [],
    });

    expect(result.characters).toHaveLength(1);
    const merged = result.characters[0];
    expect(merged.name).toBe('古德里安');
    expect(merged.aliases).toContain('古德里安教授');
    expect(merged.mentionCount).toBe(125);
    expect(merged.chapterAppearances).toEqual([1, 2, 3]);
    expect(result.llmFusion).toMatchObject({ judged: 2, merged: 1 });
  });

  it('LLM 整单消歧：无分组 → 保持独立', async () => {
    const { executeResolution } = await import('./resolution.agent.js');
    chatExtract.mockResolvedValue({ groups: [] });

    const result = await executeResolution({
      characters: [
        baseCharacter({ name: '紫晶翼狮王', description: '成年魔兽', mentionCount: 50 }),
        baseCharacter({ name: '小紫晶翼狮王', description: '幼崽', mentionCount: 8 }),
      ],
      locations: [],
      items: [],
    });

    expect(result.characters.map((c) => c.name).sort()).toEqual(['小紫晶翼狮王', '紫晶翼狮王']);
    expect(result.llmFusion).toMatchObject({ judged: 2, merged: 0 });
  });

  it('安全护栏："X的父亲"与"X的母亲"被分为一组 → 整组拒绝，保持两个人', async () => {
    const { executeResolution } = await import('./resolution.agent.js');
    chatExtract.mockResolvedValue({
      groups: [{ indices: [0, 1], confidence: 0.95, reason: '模型误判' }],
    });

    const result = await executeResolution({
      characters: [
        baseCharacter({ name: '路明非的父亲', description: '路明非的父亲', mentionCount: 5 }),
        baseCharacter({ name: '路明非的母亲', description: '路明非的母亲', mentionCount: 9 }),
      ],
      locations: [],
      items: [],
    });

    expect(result.characters.map((c) => c.name).sort()).toEqual(['路明非的母亲', '路明非的父亲']);
    expect(result.llmFusion).toMatchObject({ merged: 0 });
  });

  it('低置信分组 → 只记日志不合并', async () => {
    const { executeResolution } = await import('./resolution.agent.js');
    chatExtract.mockResolvedValue({
      groups: [{ indices: [0, 1], confidence: 0.6, reason: '拿不准' }],
    });

    const result = await executeResolution({
      characters: [
        baseCharacter({ name: '古德里安', mentionCount: 120 }),
        baseCharacter({ name: '古德里安教授', mentionCount: 5 }),
      ],
      locations: [],
      items: [],
    });

    expect(result.characters).toHaveLength(2);
    expect(result.llmFusion).toMatchObject({ merged: 0 });
  });

  it('模型未配置 → 跳过融合，角色原样通过', async () => {
    const { executeResolution } = await import('./resolution.agent.js');
    isConfigured.mockResolvedValue(false);

    const result = await executeResolution({
      characters: [
        baseCharacter({ name: '古德里安', mentionCount: 10 }),
        baseCharacter({ name: '古德里安教授', mentionCount: 5 }),
      ],
      locations: [],
      items: [],
    });

    expect(chatExtract).not.toHaveBeenCalled();
    expect(result.characters).toHaveLength(2);
    expect(result.llmFusion?.message).toContain('未配置');
  });

  it('场景消歧：同一地点的变体被分为一组 → 自动合并', async () => {
    const { executeResolution } = await import('./resolution.agent.js');
    // 调用顺序：角色融合（1 个角色，直接跳过不调用）→ 场景融合
    chatExtract.mockResolvedValueOnce({
      groups: [{ indices: [0, 1], confidence: 0.9, reason: '同一地点' }],
    });

    const baseLocation = (overrides: Record<string, unknown>) => ({
      name: '',
      aliases: [] as string[],
      description: '',
      confidence: 0.8,
      status: 'PENDING',
      importanceScore: 0.5,
      tier: 'candidate' as const,
      storyScore: 2,
      productionScore: 0.4,
      pillarCausal: 1,
      pillarUniqueness: 1,
      pillarTransition: 0,
      mentionCount: 1,
      firstChapter: 1,
      lastChapter: 1,
      chapterAppearances: [1],
      ...overrides,
    });
    const result = await executeResolution({
      characters: [baseCharacter({ name: '路明非', mentionCount: 100 })],
      locations: [
        baseLocation({ name: '丽晶酒店', description: '面试所在的酒店', mentionCount: 4, chapterAppearances: [1, 2] }),
        baseLocation({ name: '丽晶大酒店', description: '酒店大堂', mentionCount: 2, chapterAppearances: [2] }),
      ],
      items: [],
    });

    expect(result.locations).toHaveLength(1);
    expect(result.locations[0].name).toBe('丽晶酒店');
    expect(result.locations[0].aliases).toContain('丽晶大酒店');
    expect(result.locations[0].mentionCount).toBe(6);
    expect(result.llmFusion).toMatchObject({ judged: 2, merged: 1 });
  });

  it('道具分类补救：other 道具由 LLM 重新归类', async () => {
    const { executeResolution } = await import('./resolution.agent.js');
    // 调用顺序：道具融合（返回无分组）→ 道具分类
    chatExtract
      .mockResolvedValueOnce({ groups: [] })
      .mockResolvedValueOnce({ items: [{ index: 0, category: 'electronics' }, { index: 1, category: 'document' }] });

    const baseItem = (overrides: Record<string, unknown>) => ({
      name: '',
      aliases: [] as string[],
      category: 'other' as const,
      description: '',
      confidence: 0.7,
      status: 'PENDING',
      importanceScore: 0.4,
      tier: 'candidate' as const,
      storyScore: 1,
      productionScore: 0.3,
      pillarCausal: 0,
      pillarUniqueness: 1,
      pillarTransition: 0,
      mentionCount: 1,
      firstChapter: 1,
      lastChapter: 1,
      chapterAppearances: [1],
      owners: [] as unknown[],
      ...overrides,
    });
    const result = await executeResolution({
      characters: [baseCharacter({ name: '路明非', mentionCount: 100 })],
      locations: [],
      items: [
        baseItem({ name: '苹果笔记本', description: '路明非的旧笔记本电脑' }),
        baseItem({ name: '面试通知书', description: '卡塞尔学院寄来的信函' }),
      ],
    });

    expect(result.items.map((i) => `${i.name}:${i.category}`).sort()).toEqual(['苹果笔记本:electronics', '面试通知书:document']);
    expect(result.llmFusion).toMatchObject({ classified: 2 });
  });
});
