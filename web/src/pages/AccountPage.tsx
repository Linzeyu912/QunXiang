import { useEffect, useState } from 'react';
import { KeyRound, Loader2, MonitorSmartphone } from 'lucide-react';
import { toast } from 'sonner';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRotateShareCode } from '@/api/account';
import { apiFetch } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useAuthStore } from '@/store/authStore';
import { clearPendingShareCode, peekPendingShareCode } from '@/lib/one-time-share-code';
import { formatDate } from '@/lib/utils';

/** 登录会话行（H1）：设备摘要 + 最后活动时间，不含 IP。 */
interface SessionItem {
  id: string;
  deviceSummary: string;
  createdAt: string;
  lastActiveAt: string;
  expiresAt: string;
  isCurrent: boolean;
}

function SessionsCard() {
  const qc = useQueryClient();
  const sessionsQ = useQuery({
    queryKey: ['account-sessions'],
    queryFn: () => apiFetch<{ sessions: SessionItem[] }>('/account/sessions'),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => apiFetch(`/account/sessions/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('已撤销该会话');
      qc.invalidateQueries({ queryKey: ['account-sessions'] });
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const revokeOthers = useMutation({
    mutationFn: () => apiFetch<{ revoked: number }>('/account/sessions/others', { method: 'DELETE' }),
    onSuccess: (r) => {
      toast.success(`已撤销其他 ${r.revoked} 个会话`);
      qc.invalidateQueries({ queryKey: ['account-sessions'] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const sessions = sessionsQ.data?.sessions ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <MonitorSmartphone className="h-4 w-4" />
          登录会话
        </CardTitle>
        {sessions.some((s) => !s.isCurrent) && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="outline" disabled={revokeOthers.isPending}>
                撤销其他会话
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>撤销其他所有会话？</AlertDialogTitle>
                <AlertDialogDescription>
                  除当前设备外，其他所有已登录设备将立即退出，需要重新登录。当前设备不受影响。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction onClick={() => revokeOthers.mutate()}>确认撤销</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {sessionsQ.isLoading ? (
          <p className="text-muted-foreground">加载中…</p>
        ) : sessions.length === 0 ? (
          <p className="text-muted-foreground">当前没有有效会话</p>
        ) : (
          sessions.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-2 rounded border p-2">
              <div>
                <p className="font-medium">{s.deviceSummary}</p>
                <p className="text-xs text-muted-foreground">
                  最后活动 {formatDate(s.lastActiveAt)} · 过期 {formatDate(s.expiresAt)}
                </p>
              </div>
              {!s.isCurrent && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button size="sm" variant="ghost" className="text-destructive" disabled={revoke.isPending}>
                      撤销
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>撤销该会话？</AlertDialogTitle>
                      <AlertDialogDescription>
                        「{s.deviceSummary}」将立即退出登录，该设备需要重新登录才能继续使用。
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>取消</AlertDialogCancel>
                      <AlertDialogAction onClick={() => revoke.mutate(s.id)}>确认撤销</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

export function AccountPage() {
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);
  const [shareCode, setShareCode] = useState<string | null>(() => peekPendingShareCode());
  const rotate = useRotateShareCode();
  const [name, setName] = useState(user?.name ?? '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  useEffect(() => {
    if (shareCode) clearPendingShareCode(shareCode);
  }, [shareCode]);

  useEffect(() => {
    setName(user?.name ?? '');
  }, [user?.name]);

  const rotateShareCode = () => {
    rotate.mutate(undefined, {
      onSuccess: (data) => {
        setShareCode(data.shareCode);
        toast.success('分享码已轮换，旧分享码立即失效');
      },
      onError: (error) => {
        toast.error(error instanceof Error ? error.message : '分享码轮换失败');
      },
    });
  };

  const saveProfile = useMutation({
    mutationFn: () => apiFetch<{ user: { id: string; email: string; name: string } }>('/account/profile', {
      method: 'PATCH',
      body: { name },
    }),
    onSuccess: (r) => {
      setUser(r.user);
      toast.success('名称已更新（邮箱暂不支持修改）');
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const changePassword = useMutation({
    mutationFn: () => apiFetch<{ message: string }>('/account/change-password', {
      method: 'POST',
      body: { currentPassword, newPassword },
    }),
    onSuccess: (r) => {
      toast.success(r.message);
      setCurrentPassword('');
      setNewPassword('');
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">账号</h1>
        <p className="mt-1 text-sm text-muted-foreground">管理账号信息、副本分享码和登录会话。</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">账号信息</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div><span className="text-muted-foreground">邮箱：</span>{user?.email ?? '未加载'}（暂不支持修改）</div>
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1">
              <label className="text-xs text-muted-foreground" htmlFor="account-name">名称</label>
              <Input id="account-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
            </div>
            <Button size="sm" disabled={saveProfile.isPending || !name.trim() || name === user?.name} onClick={() => saveProfile.mutate()}>
              保存
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4" />
            副本分享码
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {shareCode ? (
            <div className="rounded-md border border-warning/40 bg-warning/10 p-4">
              <p className="text-sm font-medium">分享码只显示这一次，请立即安全保存。</p>
              <code className="mt-3 block break-all rounded bg-background p-3 text-sm">
                {shareCode}
              </code>
              <p className="mt-2 text-xs text-muted-foreground">刷新页面后无法再次查看明文。</p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              系统只保存分享码摘要，不保存明文。如已遗失，请轮换生成新分享码。
            </p>
          )}
          <Button onClick={rotateShareCode} disabled={rotate.isPending}>
            {rotate.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            轮换分享码
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">修改密码</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-xs text-muted-foreground">修改成功后将撤销全部登录会话，需要重新登录。</p>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground" htmlFor="current-password">当前密码</label>
            <Input id="current-password" type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground" htmlFor="new-password">新密码（至少 8 位）</label>
            <Input id="new-password" type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </div>
          <Button
            size="sm"
            disabled={changePassword.isPending || !currentPassword || newPassword.length < 8}
            onClick={() => changePassword.mutate()}
          >
            修改密码
          </Button>
        </CardContent>
      </Card>

      <SessionsCard />
    </div>
  );
}
