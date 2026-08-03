import { cn } from '@/lib/utils';

/** 加载占位骨架：用于列表/卡片加载中状态，比纯文字「加载中…」更接近最终布局。 */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} {...props} />;
}

// 行宽按固定节奏错开，模拟真实文本段落的长短不一
const LINE_WIDTHS = ['w-full', 'w-11/12', 'w-full', 'w-4/5', 'w-3/5'];

/** 面板级加载骨架：标题行 + 若干文本行，用于卡片/面板内容区。 */
function PanelSkeleton({ lines = 4, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-3 p-6', className)} aria-label="内容加载中">
      <Skeleton className="h-5 w-1/3" />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={cn('h-4', LINE_WIDTHS[i % LINE_WIDTHS.length])} />
      ))}
    </div>
  );
}

/** 行列表加载骨架：图标 + 双行文本 + 右侧徽标，用于任务历史等行式列表。 */
function RowListSkeleton({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)} aria-label="列表加载中">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-lg border bg-card px-4 py-2.5">
          <Skeleton className="h-4 w-4 rounded-full" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="h-5 w-12" />
        </div>
      ))}
    </div>
  );
}

export { Skeleton, PanelSkeleton, RowListSkeleton };
