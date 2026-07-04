import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { ErrorBoundary } from 'react-error-boundary';
import { toast, Toaster } from 'sonner';
import { App } from './App';
import { ErrorFallback } from './components/ErrorFallback';
import { ApiError } from './api/client';
import { translateApiError } from './utils/errorTranslator';
import './index.css';

/**
 * 全局查询错误提示。约束：
 * - 跳过 404 / 「尚未提取」：这两类由各页面用 isError 自行处理（如资产未提取态）。
 * - 同一 queryKey 5s 内只提示一次，避免 retry / window focus 重试造成刷屏。
 * - 仅作用于查询；变更（mutation）的错误仍由各调用点就地提示，不重复弹窗。
 */
const recentErrorKeys = new Map<string, number>();
function shouldReportError(error: unknown, queryKey: unknown): boolean {
  if (error instanceof ApiError && (error.status === 404 || error.message.includes('尚未提取'))) {
    return false;
  }
  const key = JSON.stringify(queryKey);
  const now = Date.now();
  const last = recentErrorKeys.get(key);
  if (last && now - last < 5000) return false;
  recentErrorKeys.set(key, now);
  return true;
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      if (!shouldReportError(error, query.queryKey)) return;
      toast.error(translateApiError(error));
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000,
      refetchOnWindowFocus: true,
      retry: 1,
    },
    mutations: {
      retry: 0,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary FallbackComponent={ErrorFallback}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
          <Toaster position="top-right" richColors closeButton />
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
