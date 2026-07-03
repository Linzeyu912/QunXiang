import { cn } from '@/lib/utils';

/**
 * 边界置信度条，阈值与后端一致：
 * >=0.82 自动可信（绿）；0.65~0.82 需人工确认（黄）；<0.65 强警告（红）。
 */
export function BoundaryConfidenceBar({ value, compact }: { value: number; compact?: boolean }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  const color = value >= 0.82 ? 'bg-emerald-500' : value >= 0.65 ? 'bg-amber-500' : 'bg-destructive';
  return (
    <div className={cn('space-y-1', compact && 'space-y-0.5')}>
      {!compact && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">边界置信度</span>
          <span className="font-mono">{value.toFixed(2)}</span>
        </div>
      )}
      <div className={cn('w-full rounded-full bg-secondary', compact ? 'h-1' : 'h-1.5')}>
        <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
