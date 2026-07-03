import { CheckCircle2, Clock, Loader2, XCircle } from 'lucide-react';
import { cn, formatDate } from '@/lib/utils';
import type { ExtractionStageInfo } from '@/types';

const icons = {
  pending: <Clock className="h-4 w-4 text-muted-foreground" />,
  running: <Loader2 className="h-4 w-4 animate-spin text-sky-500" />,
  completed: <CheckCircle2 className="h-4 w-4 text-emerald-500" />,
  failed: <XCircle className="h-4 w-4 text-destructive" />,
} as const;

const border = {
  pending: 'border-border',
  running: 'border-sky-400 bg-sky-50/50 dark:border-sky-500/40 dark:bg-sky-500/10',
  completed: 'border-emerald-400 bg-emerald-50/40 dark:border-emerald-500/40 dark:bg-emerald-500/10',
  failed: 'border-destructive bg-destructive/5',
} as const;

export function StageCard({ stage }: { stage: ExtractionStageInfo }) {
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-lg border p-4 transition-colors',
        border[stage.status],
      )}
    >
      <div className="mt-0.5">{icons[stage.status]}</div>
      <div className="flex-1 space-y-1">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">{stage.name}</p>
          <span className="text-xs text-muted-foreground">权重 {stage.weight}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          {stage.startedAt ? `开始于 ${formatDate(stage.startedAt)}` : '未开始'}
          {stage.completedAt && ` · 完成于 ${formatDate(stage.completedAt)}`}
        </p>
        {stage.message && stage.status === 'failed' && (
          <p className="text-xs text-destructive">{stage.message}</p>
        )}
      </div>
    </div>
  );
}
