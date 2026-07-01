import { create } from 'zustand';
import type { Book } from '../api/client';

export interface ExtractionStage {
  name: 'extractor' | 'validator' | 'entity-resolution' | 'description-fusion' | 'visual-description' | 'reviewer';
  status: 'pending' | 'running' | 'completed' | 'failed';
  message?: string;
  startedAt?: string;
  completedAt?: string;
}

interface BookState {
  books: Book[];
  extractionProgress: Record<string, ExtractionStage[]>;
  filters: { search: string; status: string };
  setBooks: (books: Book[]) => void;
  addBook: (book: Book) => void;
  removeBook: (id: string) => void;
  updateBook: (id: string, data: Partial<Book>) => void;
  setExtractionProgress: (bookId: string, stages: ExtractionStage[]) => void;
  updateExtractionStage: (bookId: string, stageName: ExtractionStage['name'], status: ExtractionStage['status'], message?: string) => void;
  setFilters: (filters: Partial<BookState['filters']>) => void;
}

// TODO: 暗黑模式实现后启用 theme/setTheme 字段（当前 SettingsPage 的暗黑开关为占位状态）
// 已移除未消费的 useCharacterStore，各页面使用本地 useState 管理角色数据
// 当页面增多需共享角色状态时再重新引入
interface UIState {
  sidebarCollapsed: boolean;
  llmProvider: string;
  llmConfigured: boolean;
  llmLoaded: boolean;
  keyHint: string;
  llmBaseUrl: string;
  llmModel: string;
  // TODO: 暗黑模式待实现
  // theme: 'light' | 'dark';
  setSidebarCollapsed: (v: boolean) => void;
  setLlmStatus: (provider: string, configured: boolean) => void;
  setLlmConfig: (data: { provider: string; configured: boolean; keyHint?: string; baseUrl?: string; model?: string }) => void;
  setLlmLoaded: (loaded: boolean) => void;
  // TODO: 暗黑模式待实现
  // setTheme: (theme: 'light' | 'dark') => void;
}

export const useBookStore = create<BookState>((set) => ({
  books: [],
  extractionProgress: {},
  filters: { search: '', status: 'all' },
  setBooks: (books) => set({ books }),
  addBook: (book) => set((state) => ({ books: [book, ...state.books] })),
  removeBook: (id) => set((state) => ({ books: state.books.filter((b) => b.id !== id) })),
  updateBook: (id, data) => set((state) => ({
    books: state.books.map((b) => (b.id === id ? { ...b, ...data } : b)),
  })),
  setExtractionProgress: (bookId, stages) => set((state) => ({
    extractionProgress: { ...state.extractionProgress, [bookId]: stages },
  })),
  updateExtractionStage: (bookId, stageName, status, message) => set((state) => {
    const existing = state.extractionProgress[bookId] || [];
    const updated = existing.map((s) =>
      s.name === stageName
        ? {
            ...s,
            status,
            message,
            ...(status === 'running' ? { startedAt: new Date().toISOString() } : {}),
            ...(status === 'completed' || status === 'failed' ? { completedAt: new Date().toISOString() } : {}),
          }
        : s
    );
    if (!updated.find((s) => s.name === stageName)) {
      updated.push({
        name: stageName,
        status,
        message,
        startedAt: new Date().toISOString(),
      });
    }
    return { extractionProgress: { ...state.extractionProgress, [bookId]: updated } };
  }),
  setFilters: (filters) => set((state) => ({ filters: { ...state.filters, ...filters } })),
}));

export const useUIStore = create<UIState>((set) => ({
  sidebarCollapsed: false,
  llmProvider: '',
  llmConfigured: false,
  llmLoaded: false,
  keyHint: '',
  llmBaseUrl: '',
  llmModel: '',
  setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
  setLlmStatus: (provider, configured) => set({ llmProvider: provider, llmConfigured: configured, llmLoaded: true }),
  setLlmConfig: (data) => set({
    llmProvider: data.provider,
    llmConfigured: data.configured,
    llmLoaded: true,
    ...(data.keyHint !== undefined ? { keyHint: data.keyHint } : {}),
    ...(data.baseUrl !== undefined ? { llmBaseUrl: data.baseUrl } : {}),
    ...(data.model !== undefined ? { llmModel: data.model } : {}),
  }),
  setLlmLoaded: (loaded) => set({ llmLoaded: loaded }),
}));
