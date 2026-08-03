import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';
import type { ConcurrencyMode, ConcurrencyStatus, ImageStatus, LlmStatus } from '@/types';

export const llmKey = {
  status: ['llm', 'status'] as const,
  presets: ['llm', 'presets'] as const,
};

export interface ProviderModel {
  id: string;
  name: string;
  /** 默认图片尺寸，选中模型时自动填充 */
  defaultSize?: string;
}

export interface ProviderPreset {
  id: string;
  name: string;
  baseUrl: string;
  models: ProviderModel[];
}

export function useLlmPresets() {
  return useQuery({
    queryKey: llmKey.presets,
    queryFn: () => apiFetch<{ presets: ProviderPreset[] }>('/health/llm/presets'),
    staleTime: Infinity,
  });
}

export function useLlmStatus() {
  return useQuery({
    queryKey: llmKey.status,
    queryFn: () => apiFetch<LlmStatus>('/health/llm'),
    staleTime: 15_000,
  });
}

export function useSetLlmProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (provider: 'llm' | 'mock' | 'auto') =>
      apiFetch<LlmStatus>('/health/llm', { method: 'PATCH', body: { provider } }),
    onSuccess: (data) => {
      qc.setQueryData(llmKey.status, data);
    },
  });
}

export interface LlmConfigPatch {
  provider: 'custom';
  apiKey?: string;
  /** 多 key：整体替换。后端会用它覆盖现有 key 集合。 */
  apiKeys?: string[];
  baseUrl?: string;
  model?: string;
}

export function useSetLlmConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: LlmConfigPatch) =>
      apiFetch<LlmStatus>('/health/llm/config', { method: 'PATCH', body: patch }),
    onSuccess: (data) => {
      qc.setQueryData(llmKey.status, data);
    },
  });
}

/** 切换并发模式（优先并行本数 / 优先单本速度），热重载 worker 数。 */
export function useSetConcurrencyMode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (mode: ConcurrencyMode) =>
      apiFetch<ConcurrencyStatus>('/health/llm/concurrency', { method: 'PATCH', body: { mode } }),
    onSuccess: (data) => {
      // 把新的 concurrency 合并进缓存的 status
      qc.setQueryData<LlmStatus | undefined>(llmKey.status, (old) =>
        old ? { ...old, concurrency: data } : old,
      );
    },
  });
}

export interface LlmTestResult {
  success: boolean;
  message: string;
  /** 原始错误片段（截断），用于在 UI 展示具体失败原因，便于排查 base url/key/model */
  detail?: string;
  timestamp: string;
}

export function useTestLlmConnection() {
  return useMutation({
    mutationFn: () => apiFetch<LlmTestResult>('/health/llm/test', { method: 'POST' }),
  });
}

// ── Image generation config ──

export function useImagePresets() {
  return useQuery({
    queryKey: ['image', 'presets'],
    queryFn: () => apiFetch<{ presets: ProviderPreset[] }>('/health/image/presets'),
    staleTime: Infinity,
  });
}

export function useImageStatus() {
  return useQuery({
    queryKey: ['image', 'status'],
    queryFn: () => apiFetch<ImageStatus>('/health/image'),
    staleTime: 15_000,
  });
}

export interface ImageConfigPatch {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  size?: string;
  characterRatio?: string;
  itemRatio?: string;
  locationRatio?: string;
}

export function useSetImageConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: ImageConfigPatch) =>
      apiFetch<ImageStatus>('/health/image/config', { method: 'PATCH', body: patch }),
    onSuccess: (data) => {
      qc.setQueryData(['image', 'status'], data);
    },
  });
}

export function useTestImageConnection() {
  return useMutation({
    mutationFn: () => apiFetch<{ success: boolean; message: string; timestamp: string }>(
      '/health/image/test',
      { method: 'POST' },
    ),
  });
}
