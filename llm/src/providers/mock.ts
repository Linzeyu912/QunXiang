import type { LLMProvider } from '../index.js';
import type { ZodSchema } from 'zod';
import { ProviderNotConfiguredError } from '../errors.js';

/**
 * Mock provider that returns Journey to the West characters
 * ONLY enabled when LLM_MOCK_ENABLED=true, not as silent fallback
 */
export function createMockProvider(): LLMProvider {
  return {
    name: 'mock',

    isConfigured(): boolean {
      // Enabled when either LLM_MOCK_ENABLED=true or LLM_PROVIDER=mock
      return process.env.LLM_MOCK_ENABLED === 'true' || process.env.LLM_PROVIDER === 'mock';
    },

    async chatExtract<T>(
      _systemPrompt: string,
      _userPrompt: string,
      _schema: ZodSchema<T>
    ): Promise<T> {
      const enabled = process.env.LLM_MOCK_ENABLED === 'true' || process.env.LLM_PROVIDER === 'mock';
      if (!enabled) {
        throw new ProviderNotConfiguredError('mock');
      }
      const mockCharacters = [
        { name: '唐僧', aliases: ['玄奘', '金蝉子', '唐三藏'], description: '取经团队领袖，原金蝉子转世', confidence: 0.95, chapterAppearances: [1, 2, 3] },
        { name: '孙悟空', aliases: ['齐天大圣', '美猴王', '猴哥'], description: '取经团队核心战力，大闹天宫后被压五指山', confidence: 0.93, chapterAppearances: [1, 2, 3] },
        { name: '猪八戒', aliases: ['猪悟能', '天蓬元帅'], description: '取经团队成员，因调戏嫦娥被贬下凡', confidence: 0.91, chapterAppearances: [2, 3] },
        { name: '沙悟净', aliases: ['沙僧', '卷帘大将'], description: '取经团队成员，原天宫卷帘大将', confidence: 0.88, chapterAppearances: [2, 3] },
        { name: '白龙马', aliases: ['小白龙'], description: '取经团队脚力，西海龙王三太子所化', confidence: 0.85, chapterAppearances: [3] },
      ];
      const mockItems = [
        { name: '金箍棒', aliases: ['如意金箍棒'], description: '孙悟空的兵器，原东海龙宫定海神针', confidence: 0.9 },
        { name: '九齿钉耙', aliases: [], description: '猪八戒的兵器，原天蓬元帅所用', confidence: 0.8 },
      ];
      // Shape matches extractionResultSchema: { characters, items }
      return { characters: mockCharacters, items: mockItems } as unknown as T;
    },
  };
}
