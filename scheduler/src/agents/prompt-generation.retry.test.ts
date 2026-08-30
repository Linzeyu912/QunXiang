import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const chatExtract = vi.fn();

vi.mock('@qunxiang/llm', () => ({
  getDefaultProvider: vi.fn(async () => ({ chatExtract })),
}));

/**
 * 润色组级容错（LLM 路径）：
 * 大组失败 → 缺口拆半；缩小到少量实体后逐个单试；单实体失败重试一次。
 */
describe('提示词润色拆半与逐实体兜底', () => {
  beforeEach(() => {
    chatExtract.mockReset();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function loadAgent() {
    vi.stubEnv('PROMPT_GEN_USE_LLM', '1');
    vi.stubEnv('LLM_PROVIDER', 'custom');
    vi.resetModules();
    const mod = await import('./prompt-generation.agent.js');
    return mod.executePromptGeneration;
  }

  const baseChar = (name: string, mention: number) => ({
    name,
    aliases: [],
    confidence: 0.9,
    status: 'PENDING',
    tier: 'core',
    mentionCount: mention,
  });
  const pack = (name: string) => ({
    name,
    entityType: 'character',
    sourceDescription: `${name}的简介`,
    visualFields: {},
    visualDetails: {},
    outfits: [],
  });
  const names = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛'];
  const buildPayload = () => ({
    characters: names.map((n) => baseChar(n, 100)),
    locations: [],
    items: [],
    characterVisualDescriptions: names.map(pack),
    locationVisualDescriptions: [],
    itemVisualDescriptions: [],
  });

  it('整组失败一次后，缺口逐实体单试兜底成功', async () => {
    const executePromptGeneration = await loadAgent();
    chatExtract
      // 首次大组调用失败
      .mockRejectedValueOnce(new Error('output truncated'))
      // 之后每次调用返回 payload 中的全部实体（排除提示词示例里的"萧炎"）
      .mockImplementation(async (_sys: string, user: string) => {
        const namesInPayload = [...user.matchAll(/"name": "([^"]+)"/g)]
          .map((m) => m[1])
          .filter((n) => n !== '萧炎' && n !== '聚气散');
        return {
          prompts: namesInPayload.map((name) => ({
            name,
            polishedPrompt: `四视图角色设定图 —— ${name}（润色版）`,
          })),
        };
      });

    const result = await executePromptGeneration(buildPayload());
    expect(result.characterPrompts).toHaveLength(names.length);
    for (const p of result.characterPrompts) {
      expect(p.prompt).toContain('（润色版）');
      expect(p.source).toBe('llm-polished');
    }
  });

  it('单实体两次都失败才标 llm-fallback', async () => {
    const executePromptGeneration = await loadAgent();
    chatExtract.mockRejectedValue(new Error('always fails'));

    const result = await executePromptGeneration(buildPayload());
    const sources = new Set(result.characterPrompts.map((p) => p.source));
    expect(sources.has('llm-fallback')).toBe(true);
    // 8 实体一组：首次组失败 1 次 → 拆半 4+4 各失败 2 次 → 每实体单试+重试 4×2×2=16 次 = 19 次
    expect(chatExtract).toHaveBeenCalledTimes(19);
  });
});
