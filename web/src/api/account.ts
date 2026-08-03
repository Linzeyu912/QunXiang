import { useMutation } from '@tanstack/react-query';
import { apiFetch } from './client';

export function useRotateShareCode() {
  return useMutation({
    mutationFn: () => apiFetch<{ shareCode: string }>('/account/share-code/rotate', {
      method: 'POST',
    }),
  });
}
