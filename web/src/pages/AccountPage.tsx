import { useEffect, useState } from 'react';
import { KeyRound, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useRotateShareCode } from '@/api/account';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuthStore } from '@/store/authStore';
import { clearPendingShareCode, peekPendingShareCode } from '@/lib/one-time-share-code';

export function AccountPage() {
  const user = useAuthStore((state) => state.user);
  const [shareCode, setShareCode] = useState<string | null>(() => peekPendingShareCode());
  const rotate = useRotateShareCode();

  useEffect(() => {
    if (shareCode) clearPendingShareCode(shareCode);
  }, [shareCode]);

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

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">账号</h1>
        <p className="mt-1 text-sm text-muted-foreground">管理账号信息和书库分享码。</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">账号信息</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div><span className="text-muted-foreground">名称：</span>{user?.name ?? '未加载'}</div>
          <div><span className="text-muted-foreground">邮箱：</span>{user?.email ?? '未加载'}</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4" />
            书库分享码
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {shareCode ? (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-4">
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
    </div>
  );
}
