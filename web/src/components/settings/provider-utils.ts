import type { ProviderPreset } from '@/api/llm';

/** 根据已保存的 baseUrl/model 反推出匹配的预设服务商和模型 */
export function matchPreset(
  presets: ProviderPreset[],
  baseUrl: string,
  model: string,
): { providerId: string; modelId: string } | null {
  if (!baseUrl) return null;
  for (const p of presets) {
    if (baseUrl === p.baseUrl || baseUrl === p.baseUrl.replace(/\/+$/, '')) {
      const matched = p.models.find((m) => m.id === model);
      return { providerId: p.id, modelId: matched ? matched.id : '' };
    }
  }
  return null;
}
