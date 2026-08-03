import { useEffect, useState } from 'react';
import { Loader2, Download, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { DownloadStateBadge } from './DownloadStateBadge';
import { useBookDownloadState, usePrepareDownload, useRequestDownload } from '@/api/downloads';

/**
 * 书库每行书籍的完整数据包下载区：徽标 + 按状态切换的动作
 * （准备/打包中/下载/更新/重新准备）。访问令牌仅内存；签名 URL 不持久化。
 *
 * 即时反馈：点击"准备下载"后立即把徽标切到"准备中"（不等下一轮轮询）；
 * 点击"下载"后显示"下载中…"提示，数秒后自动消失。
 */
export function BookDownloadSection({ bookId }: { bookId: string }) {
  const stateQ = useBookDownloadState(bookId);
  const prepare = usePrepareDownload(bookId);
  const request = useRequestDownload(bookId, stateQ.data?.snapshotId);
  const serverState = stateQ.data?.state ?? 'not-prepared';

  // 本地即时状态：点击后立刻反馈，服务器轮询跟上后自动让位
  const [prepareClicked, setPrepareClicked] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // 服务器状态一旦脱离 not-prepared（已进入打包队列），本地提示就可以退场
  useEffect(() => {
    if (serverState !== 'not-prepared') setPrepareClicked(false);
  }, [serverState]);

  const showPreparing = prepare.isPending || (prepareClicked && serverState === 'not-prepared');
  const s = showPreparing ? 'preparing' : serverState;

  const handlePrepare = async () => {
    setPrepareClicked(true);
    try {
      await prepare.mutateAsync();
      toast.success('已开始准备完整数据包');
    } catch (e) {
      setPrepareClicked(false);
      toast.error(`准备失败：${(e as Error).message}`);
    }
  };

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const auth = await request.mutateAsync();
      const a = document.createElement('a');
      a.href = auth.url;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // 浏览器接管下载后无法监听完成，提示短暂停留后消失
      window.setTimeout(() => setDownloading(false), 5000);
    } catch (e) {
      setDownloading(false);
      toast.error(`下载失败：${(e as Error).message}`);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <DownloadStateBadge state={s} />
      {downloading && (
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          下载中…
        </span>
      )}
      {s === 'not-prepared' && (
        <Button size="sm" variant="outline" onClick={handlePrepare} disabled={prepare.isPending} className="gap-1">
          {prepare.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          准备下载
        </Button>
      )}
      {s === 'preparing' && (
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          准备中，打包完成后可下载…
        </span>
      )}
      {s === 'ready' && (
        <Button size="sm" variant="outline" onClick={handleDownload} disabled={request.isPending || downloading} className="gap-1">
          {request.isPending || downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          {downloading ? '下载中…' : '下载完整数据'}
        </Button>
      )}
      {s === 'needs-update' && (
        <>
          <Button size="sm" variant="outline" onClick={handleDownload} disabled={request.isPending || downloading} className="gap-1">
            <Download className="h-3.5 w-3.5" /> {downloading ? '下载中…' : '下载旧版'}
          </Button>
          <Button size="sm" variant="secondary" onClick={handlePrepare} disabled={prepare.isPending} className="gap-1">
            <RefreshCw className="h-3.5 w-3.5" /> 更新数据包
          </Button>
        </>
      )}
      {s === 'failed' && (
        <Button size="sm" variant="outline" onClick={handlePrepare} disabled={prepare.isPending} className="gap-1">
          <RefreshCw className="h-3.5 w-3.5" /> 重新准备
        </Button>
      )}
    </div>
  );
}
