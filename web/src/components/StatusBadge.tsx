import { Badge } from './ui/badge';
import type { BookStatus, EntityStatus, StageStatus, Tier } from '@/types';

const BOOK: Record<BookStatus, { label: string; variant: 'info' | 'warning' | 'success' | 'destructive' }> = {
  UPLOADED: { label: '待提取', variant: 'info' },
  EXTRACTING: { label: '提取中', variant: 'warning' },
  EXTRACTED: { label: '已提取', variant: 'success' },
  FAILED: { label: '失败', variant: 'destructive' },
};

const ENTITY: Record<EntityStatus, { label: string; variant: 'muted' | 'success' | 'destructive' }> = {
  PENDING: { label: '待审核', variant: 'muted' },
  APPROVED: { label: '已通过', variant: 'success' },
  REJECTED: { label: '已拒绝', variant: 'destructive' },
};

const STAGE: Record<StageStatus, { label: string; variant: 'muted' | 'info' | 'success' | 'destructive' }> = {
  pending: { label: '待运行', variant: 'muted' },
  running: { label: '进行中', variant: 'info' },
  completed: { label: '完成', variant: 'success' },
  failed: { label: '失败', variant: 'destructive' },
};

const TIER: Record<Tier, { label: string; className: string }> = {
  core: { label: '核心', className: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300' },
  supporting: { label: '支撑', className: 'bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300' },
  candidate: { label: '候选', className: 'bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300' },
  archived: { label: '归档', className: 'bg-neutral-100 text-neutral-500 dark:bg-neutral-500/15 dark:text-neutral-400' },
};

export function BookStatusBadge({ status }: { status: BookStatus }) {
  const c = BOOK[status] ?? { label: status, variant: 'muted' as const };
  return <Badge variant={c.variant}>{c.label}</Badge>;
}

export function EntityStatusBadge({ status }: { status: EntityStatus }) {
  const c = ENTITY[status] ?? { label: status, variant: 'muted' as const };
  return <Badge variant={c.variant}>{c.label}</Badge>;
}

export function StageStatusBadge({ status }: { status: StageStatus }) {
  const c = STAGE[status] ?? { label: status, variant: 'muted' as const };
  return <Badge variant={c.variant}>{c.label}</Badge>;
}

export function TierBadge({ tier }: { tier: Tier }) {
  const c = TIER[tier];
  if (!c) return <Badge variant="muted">{tier}</Badge>;
  return <Badge className={c.className}>{c.label}</Badge>;
}
