import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * 标志性特征锚点过滤（纯模板路径）：
 * 上游 signatureItems/abilityVisuals 是正则扫原文的句子证据，
 * 动作句片段与含实体名/代词的半截句不得进入"★ 标志性特征"行。
 */
describe('标志性特征锚点过滤', () => {
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

  const buildPayload = (visualFields: Record<string, string>) => ({
    characters: [{ name: '韩立', aliases: [], confidence: 0.95, status: 'PENDING', tier: 'core', mentionCount: 300 }],
    locations: [],
    items: [],
    characterVisualDescriptions: [{
      name: '韩立',
      entityType: 'character',
      sourceDescription: '谨慎的乡村少年，七玄门弟子',
      visualFields,
      visualDetails: {},
      outfits: [],
    }],
    locationVisualDescriptions: [],
    itemVisualDescriptions: [],
  });

  it('动作句片段与含实体名的半截句被过滤，不进入标志性特征行', async () => {
    const executePromptGeneration = await loadAgent();
    const result = await executePromptGeneration(buildPayload({
      signatureItems: '从身上利索的摸出了一个腰牌、明晃晃的刀刃已架在了韩立的脖子上、脖子上挂着兽皮小袋',
      abilityVisuals: '而韩立运行自己的怪真气后',
    }));

    const prompt = result.characterPrompts[0].prompt;
    const anchorLine = prompt.split('\n').find((line) => line.includes('★ 标志性特征')) || '';
    expect(anchorLine).not.toContain('摸出了一个腰牌');
    expect(anchorLine).not.toContain('刀刃已架在');
    expect(anchorLine).not.toContain('运行自己的怪真气');
    // 名词性视觉锚点（兽皮小袋→储物袋类？此处验证保真：挂着兽皮小袋含动作词"挂着"也应过滤）
    expect(anchorLine).not.toContain('挂着兽皮小袋');
  });

  it('名词性视觉元素作为锚点保留', async () => {
    const executePromptGeneration = await loadAgent();
    const result = await executePromptGeneration(buildPayload({
      signatureItems: '手指黑色古戒、腰间灰色储物袋',
      abilityVisuals: '周身淡青色剑光缭绕',
    }));

    const prompt = result.characterPrompts[0].prompt;
    const anchorLine = prompt.split('\n').find((line) => line.includes('★ 标志性特征')) || '';
    expect(anchorLine).toContain('手指黑色古戒');
    expect(anchorLine).toContain('腰间灰色储物袋');
    expect(anchorLine).toContain('周身淡青色剑光缭绕');
  });

  it('全部片段被过滤时回退为"无突出标志性特征"而非半截句', async () => {
    const executePromptGeneration = await loadAgent();
    const result = await executePromptGeneration(buildPayload({
      signatureItems: '他把长剑取出之后',
      abilityVisuals: '',
    }));

    const prompt = result.characterPrompts[0].prompt;
    const anchorLine = prompt.split('\n').find((line) => line.includes('★ 标志性特征')) || '';
    expect(anchorLine).toContain('无突出标志性特征');
  });
});
