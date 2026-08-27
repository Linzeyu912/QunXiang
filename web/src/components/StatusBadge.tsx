import { Badge } from './ui/badge';
import type { BookStatus, EntityStatus, StageStatus } from '@/types';

const BOOK: Record<BookStatus, { label: string; variant: 'info' | 'warning' | 'success' | 'destructive' }> = {
  UPLOADED: { label: '待提取', variant: 'info' },
  EXTRACTING: { label: '提取中', variant: 'warning' },
  EXTRACTED: { label: '已提取', variant: 'success' },
  FAILED: { label: '失败', variant: 'destructive' },
  SEED_PREPARING: { label: '示例准备中', variant: 'info' },
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
