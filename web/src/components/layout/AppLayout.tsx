import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { BookOpen, LogOut, Moon, Settings, Sun, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/store/uiStore';
import { useAuthStore } from '@/store/authStore';
import { logoutSession } from '@/api/auth';
import { Button } from '@/components/ui/button';

export function AppLayout() {
  const navigate = useNavigate();
  const theme = useUiStore((s) => s.theme);
  const toggleTheme = useUiStore((s) => s.toggleTheme);
  const user = useAuthStore((s) => s.user);

  const handleLogout = async () => {
    try {
      await logoutSession();
      toast.success('已退出登录');
    } catch {
      toast.error('服务端退出失败，本机登录态已清除');
    } finally {
      navigate('/login', { replace: true });
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 flex h-14 items-center gap-4 border-b bg-background/95 px-6 backdrop-blur">
        <button
          onClick={() => navigate('/library')}
          className="flex items-center gap-2 font-semibold tracking-tight"
          aria-label="返回书库首页"
        >
          {/* 品牌图标做成主色实心方块，比裸图标更有辨识度 */}
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-sm">
            <BookOpen className="h-4 w-4" />
          </span>
          <span>群像</span>
          <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
            小说 IP 资产审核与交付工作台
          </span>
        </button>
        <nav className="ml-6 flex items-center gap-1 text-sm" aria-label="主导航">
          <NavLinkItem to="/library">书库</NavLinkItem>
          <NavLinkItem to="/public">公共素材库</NavLinkItem>
          <NavLinkItem to="/shared">分享给我</NavLinkItem>
          <NavLinkItem to="/settings/llm">
            <Settings className="mr-1 h-3.5 w-3.5" />
            模型与生成设置
          </NavLinkItem>
          <NavLinkItem to="/account">
            <UserRound className="mr-1 h-3.5 w-3.5" />
            账号
          </NavLinkItem>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {user && (
            <span className="hidden text-xs text-muted-foreground sm:inline" title={user.email}>
              {user.name}
            </span>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
            title={theme === 'dark' ? '浅色模式' : '深色模式'}
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleLogout}
            aria-label="退出登录"
            title="退出登录"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-6">
        <Outlet />
      </main>
    </div>
  );
}

function NavLinkItem({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'flex items-center rounded-md px-3 py-1.5 transition-colors',
          isActive
            ? 'bg-secondary font-medium text-secondary-foreground shadow-sm'
            : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
        )
      }
    >
      {children}
    </NavLink>
  );
}
