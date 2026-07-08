import { useEffect, useRef } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { toast } from 'sonner';
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
import { useBootstrapUser, loginDefaultUser } from './api/auth';

/**
 * 未登录拦截：
 * - bootstrapping：启动期等待登录态确定——有 token 时等 /auth/me 校验，无 token 时等
 *   默认账号自动登录尝试完成。期间不抢跳，避免误把正常用户弹回 /login。
 * - 退出 bootstrapping 后仍无 token（自动登录也失败）：重定向到 /login 手动登录兜底。
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
  const setAuth = useAuthStore((s) => s.setAuth);
  const setBootstrapping = useAuthStore((s) => s.setBootstrapping);
  const bootstrap = useBootstrapUser();
  const autoLoginTried = useRef(false);

  // 顶层负责用 token 换取/校验用户对象，独立于受保护路由的挂载。
  useEffect(() => {
    if (token && !user) {
      bootstrap.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // 无 token：用默认本地账号静默自动登录，免去每次开机手输账号密码。
  // 成功 → setAuth（同时退出 bootstrapping，正常进书库）；
  // 失败 → 退出 bootstrapping 落到登录页（手动登录兜底），并提示默认账号凭据，
  //        让用户知道下一步（换机后 ensureDefaultUser 可能改过密码，用户不知情）。
  useEffect(() => {
    if (token || autoLoginTried.current) return;
    autoLoginTried.current = true;
    loginDefaultUser()
      .then((data) => setAuth(data.token, data.user))
      .catch(() => {
        setBootstrapping(false);
        // 不在前端 toast 明文默认凭据（会进客户端 bundle）。仅提示手动登录，
        // 默认账号说明见 README「跨机器部署」一节。
        toast.info('自动登录失败，请手动登录。默认账号说明见 README。', {
          duration: 6000,
        });
      });
  }, [token, setAuth, setBootstrapping]);

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
