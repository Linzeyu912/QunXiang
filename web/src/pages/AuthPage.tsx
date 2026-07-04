import { useEffect, useState } from 'react';
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

export function AuthPage() {
  const navigate = useNavigate();
  const token = useAuthStore((s) => s.token);
  const login = useLogin();
  const register = useRegister();

  // 已登录则直接进书库（例如在 /login 手动访问时）。
  useEffect(() => {
    if (token) navigate('/library', { replace: true });
  }, [token, navigate]);

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
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
      register.mutate(
        { email: email.trim(), password, name: name.trim() },
        {
          onSuccess: () => {
            toast.success('注册成功，已自动登录');
            navigate('/library', { replace: true });
          },
          onError: handleErr,
        },
      );
    }
  };

  const pending = login.isPending || register.isPending;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <BookOpen className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-xl font-semibold">QunXiang</h1>
            <p className="text-xs text-muted-foreground">小说实体提取与故事链路工作台</p>
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
