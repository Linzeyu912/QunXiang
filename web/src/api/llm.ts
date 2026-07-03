import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';
import type { LlmStatus } from '@/types';

export const llmKey = {
  status: ['llm', 'status'] as const,
};

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

export interface LlmTestResult {
  success: boolean;
  message: string;
  timestamp: string;
}

export function useTestLlmConnection() {
  return useMutation({
    mutationFn: () => apiFetch<LlmTestResult>('/health/llm/test', { method: 'POST' }),
  });
}
