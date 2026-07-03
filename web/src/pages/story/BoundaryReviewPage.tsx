import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, GitMerge, Scissors } from 'lucide-react';
import { useBoundaryReviews, useResolveBoundary } from '@/api/stories';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { BoundaryConfidenceBar } from '@/components/story/BoundaryConfidenceBar';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import type { BoundaryDecision, BoundaryReviewItem } from '@/types/story';

export function BoundaryReviewPage() {
  const { bookId = '' } = useParams();
  const reviewsQ = useBoundaryReviews(bookId);
  const resolveM = useResolveBoundary(bookId);
  const [idx, setIdx] = useState(0);

  const items = reviewsQ.data?.items ?? [];
  const current = items[Math.min(idx, Math.max(0, items.length - 1))];

  const decide = (decision: BoundaryDecision) => {
    if (!current || resolveM.isPending) return;
    if (decision === 'merge_with_previous' && !current.canMerge) {
      toast.error('该段没有可合并的上一段');
      return;
    }
    resolveM.mutate(
      { reviewId: current.id, decision },
      {
        onSuccess: (res) => {
          if (res.merged) toast.success('已并入上一段，相关资产已失效待重新提取');
          if (res.pendingCount === 0) toast.success('边界已全部裁决完成');
          // 列表因 invalidate 缩短，idx 原位即指向下一条
          setIdx((i) => Math.min(i, Math.max(0, res.pendingCount - 1)));
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
      },
    );
  };

  useKeyboardShortcuts(
    {
      s: () => decide('confirm'),
      m: () => decide('merge_with_previous'),
      arrowleft: () => setIdx((i) => Math.max(0, i - 1)),
      arrowright: () => setIdx((i) => Math.min(items.length - 1, i + 1)),
    },
    true,
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" asChild>
            <Link to={`/books/${bookId}/stories`} aria-label="返回故事列表">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h2 className="text-lg font-semibold">边界审核</h2>
            <p className="text-xs text-muted-foreground">
              剩余 {items.length} 条 · 快捷键 S=确认边界 M=并入上一段 ←→ 导航
            </p>
          </div>
        </div>
        {items.length > 1 && (
          <div className="flex items-center gap-1 text-sm text-muted-foreground">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIdx((i) => Math.max(0, i - 1))}
              aria-label="上一条边界"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            {Math.min(idx, items.length - 1) + 1} / {items.length}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIdx((i) => Math.min(items.length - 1, i + 1))}
              aria-label="下一条边界"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      {reviewsQ.isLoading ? (
        <p className="p-6 text-sm text-muted-foreground">加载中…</p>
      ) : items.length === 0 ? (
        <DoneState bookId={bookId} />
      ) : (
        current && <ReviewCard item={current} busy={resolveM.isPending} onDecide={decide} />
      )}
    </div>
  );
}

function DoneState({ bookId }: { bookId: string }) {
  return (
    <div className="flex h-[40vh] flex-col items-center justify-center gap-3 rounded-lg border border-dashed">
      <CheckCircle2 className="h-10 w-10 text-emerald-500" />
      <p className="text-sm font-medium">边界已全部裁决</p>
      <p className="text-xs text-muted-foreground">现在可以回到故事页审批各故事段了。</p>
      <Button asChild>
        <Link to={`/books/${bookId}/stories`}>返回故事列表</Link>
      </Button>
    </div>
  );
}

function ReviewCard({
  item,
  busy,
  onDecide,
}: {
  item: BoundaryReviewItem;
  busy: boolean;
  onDecide: (d: BoundaryDecision) => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="flex items-center justify-between border-b bg-muted/40 px-4 py-2.5">
        <span className="text-sm font-medium">
          第 {item.betweenChapter[0]} 章 与 第 {item.betweenChapter[1]} 章 之间的边界
        </span>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            AI 建议：{item.suggestedDecision === 'confirm' ? '确认边界' : '并入上一段'}
          </span>
          <div className="w-28">
            <BoundaryConfidenceBar value={item.confidence} compact />
          </div>
          <span className="font-mono text-xs">{item.confidence.toFixed(2)}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 divide-x">
        <div className="p-4">
          <p className="mb-1 text-xs font-medium text-muted-foreground">上一段结尾</p>
          <p className="text-sm leading-relaxed">{item.leftSummary}</p>
          <div className="mt-2 flex flex-wrap gap-1">
            {item.evidence.leftCharacters.map((c) => (
              <Badge key={c} variant={item.evidence.sharedCharacters.includes(c) ? 'info' : 'muted'}>
                {c}
              </Badge>
            ))}
          </div>
        </div>
        <div className="p-4">
          <p className="mb-1 text-xs font-medium text-muted-foreground">本段开头</p>
          <p className="text-sm leading-relaxed">{item.rightSummary}</p>
          <div className="mt-2 flex flex-wrap gap-1">
            {item.evidence.rightCharacters.map((c) => (
              <Badge key={c} variant={item.evidence.sharedCharacters.includes(c) ? 'info' : 'muted'}>
                {c}
              </Badge>
            ))}
          </div>
        </div>
      </div>

      <Separator />

      <div className="space-y-2 p-4">
        <p className="text-xs font-medium text-muted-foreground">证据</p>
        <div className="flex flex-wrap gap-x-6 gap-y-1.5 text-sm">
          <span>
            共享主角：
            {item.evidence.sharedCharacters.length > 0
              ? item.evidence.sharedCharacters.join('、')
              : '（无）'}
          </span>
          {item.evidence.arcType && <span>弧线类型：{item.evidence.arcType}</span>}
        </div>
        {item.evidence.turningPoints.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-sm">
            <span className="text-muted-foreground">本段转折：</span>
            {item.evidence.turningPoints.map((t, i) => (
              <Badge key={i} variant="outline">
                {t}
              </Badge>
            ))}
          </div>
        )}
        <p className="rounded-md bg-muted/50 p-2 text-xs leading-relaxed text-muted-foreground">
          {item.reason}
        </p>
      </div>

      <div className="flex items-center justify-center gap-3 border-t bg-muted/30 px-4 py-3">
        <Button disabled={busy} onClick={() => onDecide('confirm')}>
          <Scissors className="mr-1.5 h-4 w-4" />
          确认边界 (S)
        </Button>
        <Button
          variant="outline"
          disabled={busy || !item.canMerge}
          title={item.canMerge ? undefined : '该段没有上一段'}
          onClick={() => onDecide('merge_with_previous')}
        >
          <GitMerge className="mr-1.5 h-4 w-4" />
          并入上一段 (M)
        </Button>
      </div>
    </div>
  );
}
