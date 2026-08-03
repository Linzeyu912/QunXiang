import { Suspense, lazy, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { BookLayout } from './pages/BookLayout';
import { AuthPage } from './pages/AuthPage';
import { AccountPage } from './pages/AccountPage';
import { SharedWithMePage } from './pages/SharedWithMePage';
import { PublicLibraryPage } from './pages/PublicLibraryPage';
import { PublicAssetDetailPage } from './pages/PublicAssetDetailPage';
import { useAuthStore } from './store/authStore';
import { bootstrapSession } from './api/auth';

// 路由级代码分割：各页面按需加载，首屏只下载登录页 + 布局骨架。
// 具名导出通过 .then 适配成 lazy 需要的 default 导出。
const LibraryPage = lazy(() =>
  import('./pages/LibraryPage').then((m) => ({ default: m.LibraryPage })),
);
const BookIndexRedirect = lazy(() =>
  import('./pages/BookIndexRedirect').then((m) => ({ default: m.BookIndexRedirect })),
);
const PipelinePage = lazy(() =>
  import('./pages/PipelinePage').then((m) => ({ default: m.PipelinePage })),
);
const ChaptersPage = lazy(() =>
  import('./pages/ChaptersPage').then((m) => ({ default: m.ChaptersPage })),
);
const EntityReviewPage = lazy(() =>
  import('./pages/EntityReviewPage').then((m) => ({ default: m.EntityReviewPage })),
);
const ExportPage = lazy(() =>
  import('./pages/ExportPage').then((m) => ({ default: m.ExportPage })),
);
const LlmSettingsPage = lazy(() =>
  import('./pages/LlmSettingsPage').then((m) => ({ default: m.LlmSettingsPage })),
);
const NotFoundPage = lazy(() =>
  import('./pages/NotFoundPage').then((m) => ({ default: m.NotFoundPage })),
);
const StoriesPage = lazy(() =>
  import('./pages/story/StoriesPage').then((m) => ({ default: m.StoriesPage })),
);
const BoundaryReviewPage = lazy(() =>
  import('./pages/story/BoundaryReviewPage').then((m) => ({ default: m.BoundaryReviewPage })),
);
const StoryAssetsPage = lazy(() =>
  import('./pages/story/StoryAssetsPage').then((m) => ({ default: m.StoryAssetsPage })),
);
const EpisodesPage = lazy(() =>
  import('./pages/story/EpisodesPage').then((m) => ({ default: m.EpisodesPage })),
);
const DirectorPage = lazy(() =>
  import('./pages/story/DirectorPage').then((m) => ({ default: m.DirectorPage })),
);

/** 页面分包加载中的占位提示，避免路由切换时白屏。 */
function PageLoading() {
  return <div className="p-10 text-sm text-muted-foreground">页面加载中…</div>;
}

/**
 * 未登录拦截：
 * - bootstrapping：有 token 时等待 /auth/me 校验，期间不抢跳。
 * - 退出 bootstrapping 后仍无 token：重定向到登录页。
 */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const token = useAuthStore((s) => s.token);
  const bootstrapping = useAuthStore((s) => s.bootstrapping);
  if (bootstrapping) {
    return <div className="p-10 text-sm text-muted-foreground">校验登录态…</div>;
  }
  if (!token) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}

export function App() {
  // 顶层只执行一次 Cookie 会话恢复，不创建或覆盖任何账号。
  useEffect(() => {
    void bootstrapSession();
  }, []);

  return (
    <Suspense fallback={<PageLoading />}>
      <Routes>
      <Route path="/login" element={<AuthPage />} />
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route path="/" element={<Navigate to="/library" replace />} />
        <Route path="/library" element={<LibraryPage />} />
        <Route path="/books/:bookId" element={<BookLayout />}>
          <Route index element={<BookIndexRedirect />} />
          <Route path="pipeline" element={<PipelinePage />} />
          <Route path="chapters" element={<ChaptersPage />} />
          <Route path="characters" element={<EntityReviewPage type="character" />} />
          <Route path="locations" element={<EntityReviewPage type="location" />} />
          <Route path="items" element={<EntityReviewPage type="item" />} />
          <Route path="export" element={<ExportPage />} />
          <Route path="stories" element={<StoriesPage />} />
          <Route path="stories/boundary-review" element={<BoundaryReviewPage />} />
          <Route path="stories/:storyId/assets" element={<StoryAssetsPage />} />
          <Route path="stories/:storyId/episodes" element={<EpisodesPage />} />
          <Route path="director" element={<DirectorPage />} />
        </Route>
        <Route path="/settings/llm" element={<LlmSettingsPage />} />
        <Route path="/shared" element={<SharedWithMePage />} />
        <Route path="/public" element={<PublicLibraryPage />} />
        <Route path="/public/:id" element={<PublicAssetDetailPage />} />
        <Route path="/account" element={<AccountPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
    </Suspense>
  );
}
