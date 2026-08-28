import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RowListSkeleton } from '@/components/ui/skeleton';
import { useCopyShare, useSharedWithMe } from '@/api/shares';
import { formatDate } from '@/lib/utils';

const STATUS: Record<string, { label: string; variant: 'success' | 'warning' | 'default' | 'muted' }> = {
  active: { label: '可复制', variant: 'success' },
  copying: { label: '复制中', variant: 'warning' },
  copied: { label: '已复制', variant: 'default' },
  revoked: { label: '已撤销', variant: 'muted' },
};

export function SharedWithMePage() {
  const q = useSharedWithMe();
  const copy = useCopyShare();
  const navigate = useNavigate();
  const items = q.data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">分享给我</h1>
        <p className="text-sm text-muted-foreground">其他人分享给你的书籍，可复制为自己的独立副本</p>
      </div>
      {q.isLoading ? (
        <RowListSkeleton rows={3} />
      ) : items.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 border-dashed p-10 text-center">
          <p className="text-sm font-medium">暂无分享</p>
          <p className="text-xs text-muted-foreground">其他用户通过分享码分享给你的书籍会出现在这里</p>
        </Card>
      ) : (
        <div className="grid gap-3">
          {items.map((s) => {
            const st = STATUS[s.status] ?? { label: s.status, variant: 'muted' as const };
            return (
              <Card key={s.shareId} className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
                <div className="min-w-0 flex-1 basis-48">
                  <p className="truncate text-sm font-medium">{s.bookTitle}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    来自 {s.senderName || '未知'} · 版本 {s.snapshotVersion} · {formatDate(s.sharedAt)}
                  </p>
                </div>
                <Badge variant={st.variant}>{st.label}</Badge>
                <div className="flex items-center gap-1">
                  {s.status === 'active' && (
                    <Button
                      size="sm"
                      disabled={copy.isPending}
                      onClick={async () => {
                        try {
                          const r = await copy.mutateAsync(s.shareId);
                          toast.success(r.state === 'copying' ? '已开始复制，稍后在书库查看' : '已复制');
                        } catch (e) {
                          toast.error(`复制失败：${(e as Error).message}`);
                        }
                      }}
                    >
                      复制到我的书库
                    </Button>
                  )}
                  {s.status === 'copying' && (
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                      复制中…
                    </span>
                  )}
                  {s.status === 'copied' && (
                    <Button size="sm" variant="outline" onClick={() => navigate('/library')}>
                      前往书库
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
