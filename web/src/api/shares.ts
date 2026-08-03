import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';

export interface SharedWithMeItem {
  shareId: string;
  bookId: string;
  bookTitle: string;
  senderId: string;
  senderName: string;
  status: string;
  snapshotVersion: number;
  sharedAt: string;
}

export const sharesKey = {
  sharedWithMe: ['shares', 'shared-with-me'] as const,
};

export function useSharedWithMe() {
  return useQuery({
    queryKey: sharesKey.sharedWithMe,
    queryFn: () => apiFetch<{ shares: SharedWithMeItem[] }>('/shares/shared-with-me').then((r) => r.shares),
  });
}

export function useCreateShare(bookId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { recipientEmail: string; recipientShareCode: string }) =>
      apiFetch<{ share: { id: string; status: string } }>(`/books/${bookId}/shares`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: sharesKey.sharedWithMe }),
  });
}

export function useRevokeShare() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (shareId: string) => apiFetch(`/shares/${shareId}/revoke`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: sharesKey.sharedWithMe }),
  });
}

export function useCopyShare() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (shareId: string) =>
      apiFetch<{ state: string }>(`/shares/${shareId}/copy`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: sharesKey.sharedWithMe }),
  });
}
