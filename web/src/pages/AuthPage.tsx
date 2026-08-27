import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { BookOpen, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useLogin, useRegister } from '@/api/auth';
import { useAuthStore } from '@/store/authStore';
import { setPendingShareCode } from '@/lib/one-time-share-code';

export function AuthPage() {
  const navigate = useNavigate();
  const token = useAuthStore((s) => s.token);
  const bootstrapping = useAuthStore((s) => s.bootstrapping);
  const login = useLogin();
  const register = useRegister();
  const registrationInProgress = useRef(false);

  // 启动刷新恢复账号后离开登录页；注册流程由成功回调导航到一次性分享码页面。
  useEffect(() => {
    if (token && !registrationInProgress.current) navigate('/library', { replace: true });
  }, [navigate, token]);

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (bootstrapping) {
      toast.error('正在恢复登录状态，请稍候');
      return;
    }
    const handleErr = (err: unknown) =>
      toast.error(err instanceof Error ? err.message : '操作失败');
    if (mode === 'login') {
      login.mutate(
        { email: email.trim(), password },
        {
          onSuccess: () => {
            toast.success('登录成功');
            navigate('/library', { replace: true });
          },
          onError: handleErr,
        },
      );
    } else {
      registrationInProgress.current = true;
      register.mutate(
        { email: email.trim(), password, name: name.trim() },
        {
          onSuccess: (data) => {
            setPendingShareCode(data.shareCode);
            toast.success('注册成功，已自动登录');
            navigate('/account', { replace: true });
          },
          onError: (error) => {
            registrationInProgress.current = false;
            handleErr(error);
          },
        },
      );
    }
  };

  const pending = bootstrapping || login.isPending || register.isPending;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <BookOpen className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-xl font-semibold">群像</h1>
            <p className="text-xs text-muted-foreground">从小说原文中提取、审核并交付可复用的角色、场景、道具和世界观资产</p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <Tabs value={mode} onValueChange={(v) => setMode(v as 'login' | 'register')}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="login">登录</TabsTrigger>
                <TabsTrigger value="register">注册</TabsTrigger>
              </TabsList>
              <TabsContent value="login" className="mt-4">
                <CardTitle className="text-base">登录到你的工作台</CardTitle>
              </TabsContent>
              <TabsContent value="register" className="mt-4">
                <CardTitle className="text-base">创建新账户</CardTitle>
              </TabsContent>
            </Tabs>
          </CardHeader>
          <CardContent>
            <form className="space-y-3" onSubmit={submit}>
              {mode === 'register' && (
                <div className="space-y-1.5">
                  <Label htmlFor="auth-name">显示名</Label>
                  <Input
                    id="auth-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="你的称呼"
                    autoComplete="name"
                    required
                  />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="auth-email">邮箱</Label>
                <Input
                  id="auth-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="请输入邮箱"
                  autoComplete="email"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="auth-password">密码</Label>
                <Input
                  id="auth-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === 'register' ? '至少 6 位' : '密码'}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={pending}>
                {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {mode === 'login' ? '登录' : '注册并登录'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
