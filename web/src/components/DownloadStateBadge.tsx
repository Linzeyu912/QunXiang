import { Badge } from './ui/badge';
import type { DownloadState } from '@/types';

const DOWNLOAD: Record<DownloadState, { label: string; variant: 'muted' | 'info' | 'success' | 'warning' | 'destructive' }> = {
  'not-prepared': { label: '未准备下载', variant: 'muted' },
  preparing: { label: '准备中', variant: 'info' },
  ready: { label: '可下载', variant: 'success' },
  'needs-update': { label: '需更新', variant: 'warning' },
  failed: { label: '准备失败', variant: 'destructive' },
};

export function DownloadStateBadge({ state }: { state: DownloadState }) {
  const c = DOWNLOAD[state] ?? { label: state, variant: 'muted' as const };
  return <Badge variant={c.variant}>{c.label}</Badge>;
}
