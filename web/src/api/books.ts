import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';
import type { Book } from '@/types';

export const booksKey = {
  all: ['books'] as const,
  detail: (id: string) => ['books', id] as const,
  content: (id: string) => ['books', id, 'content'] as const,
};

export function useBooks() {
  return useQuery({
    queryKey: booksKey.all,
    queryFn: () => apiFetch<{ books: Book[] }>('/books').then((r) => r.books ?? []),
    // 有书正在提取时短间隔轮询，让「提取」按钮的禁用态与状态徽标及时跟上，
    // 避免缓存里的旧状态诱导用户重复触发（409 冲突）
    refetchInterval: (query) =>
      query.state.data?.some((book) => book.status === 'EXTRACTING' || book.status === 'SEED_PREPARING')
        ? 5000
        : false,
  });
}

export function useBook(id: string | undefined) {
  return useQuery({
    queryKey: id ? booksKey.detail(id) : ['books', 'none'],
    queryFn: () => apiFetch<{ book: Book }>(`/books/${id}`).then((r) => r.book),
    enabled: !!id,
  });
}

export function useBookContent(id: string | undefined) {
  return useQuery({
    queryKey: id ? booksKey.content(id) : ['books', 'none', 'content'],
    queryFn: () => apiFetch<{ content: string }>(`/books/${id}/content`).then((r) => r.content),
    enabled: !!id,
    staleTime: Infinity,
  });
}

export function useUploadBook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('file', file, file.name);
      return apiFetch<{ book: Book }>('/books', { method: 'POST', body: form }).then((r) => r.book);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: booksKey.all });
    },
  });
}

export function useDeleteBook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/books/${id}`, { method: 'DELETE' }),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: booksKey.all });
      qc.removeQueries({ queryKey: booksKey.detail(id) });
      qc.removeQueries({ queryKey: booksKey.content(id) });
    },
  });
}
