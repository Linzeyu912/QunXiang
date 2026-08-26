import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * 服饰套系提示词模板补写（USE_LLM=0 纯模板路径，不调 LLM）。
 * 模块级 USE_LLM 在 import 时读取，需 resetModules 后设置环境变量再动态导入。
 */
describe('服饰套系提示词模板补写', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function loadAgent() {
    vi.stubEnv('PROMPT_GEN_USE_LLM', '0');
    vi.stubEnv('LLM_PROVIDER', 'mock');
    vi.resetModules();
    const mod = await import('./prompt-generation.agent.js');
    return mod.executePromptGeneration;
  }

  const buildPayload = (outfits: Array<{ description: string; scene?: string; firstChapter?: number; lastChapter?: number }>) => ({
    // 与真实管线一致：入库的 character 实体不携带 outfits，服饰证据只在 visual pack 上
    characters: [{ name: '萧炎', aliases: [], confidence: 0.9, status: 'PENDING', tier: 'candidate', mentionCount: 50 }],
    locations: [],
    items: [],
    characterVisualDescriptions: [{
      name: '萧炎',
      entityType: 'character',
      sourceDescription: '天才少年，身怀神秘黑色古戒',
      visualFields: { statusMarkers: '少年' },
      visualDetails: {},
      outfits,
    }],
    locationVisualDescriptions: [],
    itemVisualDescriptions: [],
  });

  it('每套非主套服饰都有完整四视图提示词，且不再附"其余服饰套系"参考列表', async () => {
    const executePromptGeneration = await loadAgent();
    const result = await executePromptGeneration(buildPayload([
      { description: '青色劲装，袖口绣暗纹', scene: '日常', firstChapter: 1, lastChapter: 100 },
      { description: '宽大黑袍与大黑斗篷，遮掩面容', scene: '伪装炼药师', firstChapter: 20, lastChapter: 75 },
    ]));

    const prompt = result.characterPrompts[0];
    expect(prompt.outfitVariants).toHaveLength(1);
    const variant = prompt.outfitVariants![0];
    expect(variant.scene).toBe('伪装炼药师');
    expect(variant.description).toContain('宽大黑袍');
    expect(variant.prompt).toContain('四视图角色设定图');
    expect(variant.prompt).toContain('宽大黑袍与大黑斗篷');
    // 套系专属图不应再带其余套系的参考列表（避免生图模型混淆）
    expect(variant.prompt).not.toContain('其余服饰套系');
    expect(variant.sourceChapters).toContain('第20');
    expect(variant.source).toBe('template-only');
  });

  it('主套提示词保持不变：服装为主套、其余套系以参考列表呈现', async () => {
    const executePromptGeneration = await loadAgent();
    const result = await executePromptGeneration(buildPayload([
      { description: '青色劲装，袖口绣暗纹', scene: '日常', firstChapter: 1, lastChapter: 100 },
      { description: '宽大黑袍与大黑斗篷，遮掩面容', scene: '伪装炼药师', firstChapter: 20, lastChapter: 75 },
    ]));

    const prompt = result.characterPrompts[0];
    // 主套 = 章节跨度最大的"日常"套
    expect(prompt.prompt).toContain('青色劲装');
    expect(prompt.prompt).toContain('其余服饰套系');
  });

  it('只有一套服饰的角色不产出套系变体', async () => {
    const executePromptGeneration = await loadAgent();
    const result = await executePromptGeneration(buildPayload([
      { description: '青色劲装，袖口绣暗纹', scene: '日常', firstChapter: 1, lastChapter: 100 },
    ]));

    const prompt = result.characterPrompts[0];
    expect(prompt.outfitVariants ?? []).toHaveLength(0);
  });

  it('低置信度角色不生成提示词（只保留名字防遗漏）', async () => {
    const executePromptGeneration = await loadAgent();
    const payload = buildPayload([
      { description: '青色劲装，袖口绣暗纹', scene: '日常', firstChapter: 1, lastChapter: 100 },
    ]);
    // 追加一个低置信度角色及其视觉包；高置信度角色作为对照
    payload.characters.push({
      name: '守城士兵', aliases: [], confidence: 0.5, status: 'PENDING', tier: 'candidate', mentionCount: 1,
    } as never);
    payload.characterVisualDescriptions.push({
      name: '守城士兵',
      entityType: 'character',
      sourceDescription: '城门口站岗的士兵',
      visualFields: {},
      visualDetails: {},
      outfits: [],
    } as never);

    const result = await executePromptGeneration(payload);

    const names = result.characterPrompts.map((p) => p.entityName);
    expect(names).toContain('萧炎');
    expect(names).not.toContain('守城士兵');
  });
});
