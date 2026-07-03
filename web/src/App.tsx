import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { LibraryPage } from './pages/LibraryPage';
import { BookLayout } from './pages/BookLayout';
import { BookIndexRedirect } from './pages/BookIndexRedirect';
import { PipelinePage } from './pages/PipelinePage';
import { ChaptersPage } from './pages/ChaptersPage';
import { EntityReviewPage } from './pages/EntityReviewPage';
import { ExportPage } from './pages/ExportPage';
import { LlmSettingsPage } from './pages/LlmSettingsPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { StoriesPage } from './pages/story/StoriesPage';
import { BoundaryReviewPage } from './pages/story/BoundaryReviewPage';
import { StoryAssetsPage } from './pages/story/StoryAssetsPage';
import { EpisodesPage } from './pages/story/EpisodesPage';
import { DirectorPage } from './pages/story/DirectorPage';
import { AuthPage } from './pages/AuthPage';
import { useAuthStore } from './store/authStore';
import { useBootstrapUser } from './api/auth';

/**
 * 未登录拦截：
 * - bootstrapping：有 token 但尚未用 /auth/me 校验（页面刚刷新），等校验完成再决定，
 *   避免用过期 token 渲染页面后才发现要跳登录。
 * - 无 token：重定向到 /login。
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
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const bootstrap = useBootstrapUser();

  // 顶层负责用 token 换取/校验用户对象，独立于受保护路由的挂载。
  useEffect(() => {
    if (token && !user) {
      bootstrap.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
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
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
