import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  AlertTriangle,
  BookOpen,
  Boxes,
  CheckCircle2,
  Clapperboard,
  Loader2,
  Play,
  RotateCcw,
} from 'lucide-react';
import {
  useApproveBatch,
  useApproveStory,
  useExtractAssets,
  useSegmentationProgress,
  useStartSegmentation,
  useStories,
  useStoryDetail,
} from '@/api/stories';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Separator } from '@/components/ui/separator';
import { BoundaryConfidenceBar } from '@/components/story/BoundaryConfidenceBar';
import { EvidenceSnippets } from '@/components/story/EvidenceSnippets';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { formatDate } from '@/lib/utils';
import { cn } from '@/lib/utils';
import type { StorySummary } from '@/types/story';

const CONFLICT_LABEL: Record<string, string> = {
  resolved: '已解决',
  partially_resolved: '部分解决',
  ongoing: '进行中',
};

export function StoriesPage() {
  const { bookId = '' } = useParams();
  const [sp, setSp] = useSearchParams();
  const listQ = useStories(bookId);
  const approveM = useApproveStory(bookId);
  const batchM = useApproveBatch(bookId);
  const [batchMode, setBatchMode] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const stories = useMemo(() => listQ.data?.stories ?? [], [listQ.data]);
  const pending = listQ.data?.pendingBoundaryReviews ?? 0;
  const selectedId = sp.get('sel') ?? stories[0]?.id;
  const selected = stories.find((s) => s.id === selectedId) ?? stories[0];

  const handleSelect = (id: string) => {
    sp.set('sel', id);
    setSp(sp, { replace: true });
  };

  const moveSelection = (dir: 1 | -1) => {
    if (!selected || stories.length === 0) return;
    const idx = stories.findIndex((s) => s.id === selected.id);
    const next = stories[Math.max(0, Math.min(stories.length - 1, idx + dir))];
    if (next) handleSelect(next.id);
  };

  const toggleChecked = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runBatch = (approved: boolean) => {
    const storyIds = [...checked];
    if (storyIds.length === 0) return;
    batchM.mutate(
      { storyIds, approved },
      {
        onSuccess: (res) => {
          if (res.updated.length > 0) {
            toast.success(`${approved ? '已审批' : '已撤销'} ${res.updated.length} 段`);
          }
          for (const s of res.skipped) {
            toast.error(`跳过 ${s.storyId.slice(-12)}：${s.reason}`);
          }
          setChecked(new Set());
          setBatchMode(false);
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
      },
    );
  };

  useKeyboardShortcuts(
    {
      j: () => moveSelection(1),
      k: () => moveSelection(-1),
      arrowdown: () => moveSelection(1),
      arrowup: () => moveSelection(-1),
      a: () => {
        if (!selected || approveM.isPending) return;
        approveM.mutate(
          { storyId: selected.id, approved: !selected.approved },
          {
            onSuccess: (s) => toast.success(s.approved ? '已审批' : '已撤销审批'),
            onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
          },
        );
      },
    },
    true,
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">故事切分</h2>
          <p className="text-xs text-muted-foreground">
            {stories.length} 段 · {stories.filter((s) => s.approved).length} 段已审批
            {listQ.data?.generatedAt && ` · 切分于 ${formatDate(listQ.data.generatedAt)}`}
            {stories.length > 0 && ' · J/K 移动 · A 审批/撤销'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {pending > 0 && (
            <Button variant="outline" asChild>
              <Link to={`/books/${bookId}/stories/boundary-review`}>
                <AlertTriangle className="mr-1.5 h-4 w-4 text-amber-500 dark:text-amber-400" />
                边界审核 ({pending})
              </Link>
            </Button>
          )}
          {stories.length > 0 && (
            <Button
              variant={batchMode ? 'secondary' : 'outline'}
              onClick={() => {
                setBatchMode((v) => !v);
                setChecked(new Set());
              }}
            >
              {batchMode ? '退出批量' : '批量审批'}
            </Button>
          )}
          <SegmentTriggerButton bookId={bookId} hasExisting={stories.length > 0} />
        </div>
      </div>

      {batchMode && (
        <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
          <span className="text-muted-foreground">已选 {checked.size} 段</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setChecked(new Set(stories.filter((s) => !s.approved).map((s) => s.id)))}
          >
            全选待审批
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setChecked(new Set())}>
            清空
          </Button>
          <div className="flex-1" />
          <Button
            size="sm"
            disabled={checked.size === 0 || batchM.isPending}
            onClick={() => runBatch(true)}
          >
            {batchM.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            审批所选
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={checked.size === 0 || batchM.isPending}
            onClick={() => runBatch(false)}
          >
            撤销所选
          </Button>
        </div>
      )}

      {listQ.isLoading ? (
        <p className="p-6 text-sm text-muted-foreground">加载中…</p>
      ) : stories.length === 0 ? (
        <EmptyState bookId={bookId} />
      ) : (
        <div className="grid h-[calc(100vh-16rem)] grid-cols-[minmax(280px,2fr)_minmax(0,3fr)] overflow-hidden rounded-lg border bg-card">
          <div className="overflow-y-auto border-r">
            {stories.map((s) => (
              <StoryListItem
                key={s.id}
                story={s}
                selected={s.id === selected?.id}
                onSelect={() => handleSelect(s.id)}
                checked={batchMode ? checked.has(s.id) : undefined}
                onToggleCheck={batchMode ? () => toggleChecked(s.id) : undefined}
              />
            ))}
          </div>
          <div className="overflow-y-auto">
            {selected ? (
              <StoryDetailPanel bookId={bookId} story={selected} pendingReviews={pending} />
            ) : (
              <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
                选择一个故事段查看详情
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- 切分触发（含 SSE 进度） ----------

function SegmentTriggerButton({ bookId, hasExisting }: { bookId: string; hasExisting: boolean }) {
  const startM = useStartSegmentation(bookId);
  const [taskId, setTaskId] = useState<string | null>(null);

  const progress = useSegmentationProgress(bookId, taskId, (ok, error) => {
    setTaskId(null);
    if (ok) toast.success('故事切分完成');
    else toast.error(`切分失败：${error ?? '未知错误'}`);
  });

  const start = () => {
    startM.mutate(undefined, {
      onSuccess: (res) => setTaskId(res.taskId),
      onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
    });
  };

  if (progress.active) {
    return (
      <Button disabled variant="secondary">
        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
        {progress.message ?? progress.stage ?? '切分中…'}
      </Button>
    );
  }

  if (!hasExisting) {
    return (
      <Button onClick={start} disabled={startM.isPending}>
        <Play className="mr-1.5 h-4 w-4" />
        开始故事切分
      </Button>
    );
  }

  // 重切分保护：覆盖现有切分、审批与资产
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" disabled={startM.isPending}>
          <RotateCcw className="mr-1.5 h-4 w-4" />
          重新切分
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>重新切分故事？</AlertDialogTitle>
          <AlertDialogDescription>
            将覆盖现有的故事段、审批状态、已提取的资产与剧本产物，此操作不可撤销。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction onClick={start}>确认重新切分</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function EmptyState({ bookId }: { bookId: string }) {
  return (
    <div className="flex h-[40vh] flex-col items-center justify-center gap-3 rounded-lg border border-dashed">
      <BookOpen className="h-8 w-8 text-muted-foreground/50" />
      <p className="text-sm text-muted-foreground">
        还没有切分过故事。切分会按叙事弧线把章节组装成可独立改编的故事段。
      </p>
      <SegmentTriggerButton bookId={bookId} hasExisting={false} />
    </div>
  );
}

// ---------- 列表项 ----------

function StoryListItem({
  story,
  selected,
  onSelect,
  checked,
  onToggleCheck,
}: {
  story: StorySummary;
  selected: boolean;
  onSelect: () => void;
  checked?: boolean;
  onToggleCheck?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'block w-full border-b px-3 py-2.5 text-left transition-colors hover:bg-accent/50',
        selected && 'bg-accent',
      )}
    >
      <div className="flex items-center gap-2">
        {onToggleCheck && (
          <input
            type="checkbox"
            className="h-4 w-4 shrink-0"
            checked={checked ?? false}
            onChange={onToggleCheck}
            onClick={(e) => e.stopPropagation()}
          />
        )}
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
          {story.startChapter === story.endChapter
            ? `第${story.startChapter}章`
            : `第${story.startChapter}-${story.endChapter}章`}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{story.title}</span>
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        {story.approved ? (
          <Badge variant="success">已审批</Badge>
        ) : (
          <Badge variant="muted">待审批</Badge>
        )}
        {story.arcType && <Badge variant="outline">{story.arcType}</Badge>}
        <div className="min-w-0 flex-1">
          <BoundaryConfidenceBar value={story.boundaryConfidence} compact />
        </div>
      </div>
    </button>
  );
}

// ---------- 详情面板 ----------

function StoryDetailPanel({
  bookId,
  story,
  pendingReviews,
}: {
  bookId: string;
  story: StorySummary;
  pendingReviews: number;
}) {
  const navigate = useNavigate();
  const approveM = useApproveStory(bookId);
  const extractM = useExtractAssets(bookId);
  const [showSource, setShowSource] = useState(false);
  const sourceQ = useStoryDetail(bookId, showSource ? story.id : undefined, true);

  const toggleApprove = (approved: boolean) => {
    approveM.mutate(
      { storyId: story.id, approved },
      {
        onSuccess: () => toast.success(approved ? '已审批' : '已撤销审批'),
        onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
      },
    );
  };

  const extract = () => {
    extractM.mutate(story.id, {
      onSuccess: () => {
        toast.success('资产提取完成');
        navigate(`/books/${bookId}/stories/${story.id}/assets`);
      },
      onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
    });
  };

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold">{story.title}</h3>
          <p className="text-xs text-muted-foreground">
            第 {story.startChapter}-{story.endChapter} 章 · 冲突状态：
            {CONFLICT_LABEL[story.conflictStatus] ?? story.conflictStatus}
          </p>
        </div>
        {story.approved ? (
          <Button
            size="sm"
            variant="outline"
            disabled={approveM.isPending}
            onClick={() => toggleApprove(false)}
          >
            撤销审批
          </Button>
        ) : (
          <Button size="sm" disabled={approveM.isPending} onClick={() => toggleApprove(true)}>
            <CheckCircle2 className="mr-1 h-4 w-4" />
            审批本段
          </Button>
        )}
      </div>

      {!story.approved && pendingReviews > 0 && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
          提示：本书还有 {pendingReviews} 条待裁决边界。若审批时报 409，请先到
          <Link className="mx-1 underline" to={`/books/${bookId}/stories/boundary-review`}>
            边界审核
          </Link>
          完成裁决。
        </p>
      )}

      <BoundaryConfidenceBar value={story.boundaryConfidence} />

      <Separator />

      <Field label="摘要">{story.summary}</Field>
      <Field label="核心冲突">{story.coreConflict}</Field>
      <Field label="触发">{story.trigger}</Field>
      {story.goal && <Field label="目标">{story.goal}</Field>}
      {story.turningPoints.length > 0 && (
        <div>
          <FieldLabel>转折点</FieldLabel>
          <ul className="mt-1 list-inside list-disc space-y-0.5 text-sm">
            {story.turningPoints.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </div>
      )}
      {story.resolution && <Field label="解决">{story.resolution}</Field>}

      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <TagGroup label="主角" values={story.mainCharacters} variant="info" />
        <TagGroup label="配角" values={story.supportingCharacters} variant="muted" />
        <TagGroup label="地点" values={story.locations} variant="outline" />
      </div>

      {story.events && story.events.length > 0 && (
        <EvidenceSnippets snippets={story.events.map((e) => `${e.summary}（${e.evidenceSnippet}）`)} />
      )}

      <Separator />

      <div className="flex flex-wrap items-center gap-2">
        {story.assetsExtracted ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                size="sm"
                variant="secondary"
                disabled={!story.approved || extractM.isPending}
                title={story.approved ? undefined : '先审批本段才能提取资产'}
              >
                {extractM.isPending ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <Boxes className="mr-1 h-4 w-4" />
                )}
                重新提取资产
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>重新提取资产？</AlertDialogTitle>
                <AlertDialogDescription>
                  将按当前故事段重新生成全部角色、场景、道具与视觉提示词，包括你手动修改过的描述也会被覆盖。此操作不可撤销。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction onClick={extract}>确认重新提取</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            disabled={!story.approved || extractM.isPending}
            title={story.approved ? undefined : '先审批本段才能提取资产'}
            onClick={extract}
          >
            {extractM.isPending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Boxes className="mr-1 h-4 w-4" />
            )}
            提取资产
          </Button>
        )}
        {story.assetsExtracted && (
          <Button size="sm" variant="outline" asChild>
            <Link to={`/books/${bookId}/stories/${story.id}/assets`}>查看资产 →</Link>
          </Button>
        )}
        {story.directorRan && (
          <Button size="sm" variant="outline" asChild>
            <Link to={`/books/${bookId}/stories/${story.id}/episodes`}>
              <Clapperboard className="mr-1 h-4 w-4" />
              查看剧集 →
            </Link>
          </Button>
        )}
      </div>

      <div>
        <button
          type="button"
          className="text-xs text-muted-foreground underline hover:text-foreground"
          onClick={() => setShowSource((v) => !v)}
        >
          {showSource ? '收起原文' : '查看原文'}
        </button>
        {showSource && (
          <div className="mt-2 max-h-72 overflow-y-auto rounded-md bg-muted/50 p-3 text-xs leading-relaxed">
            {sourceQ.isLoading ? (
              '加载原文…'
            ) : (
              <pre className="whitespace-pre-wrap font-sans">
                {(sourceQ.data as { sourceText?: string } | undefined)?.sourceText ?? '（无法加载原文）'}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-xs font-medium text-muted-foreground">{children}</span>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <p className="mt-0.5 text-sm leading-relaxed">{children}</p>
    </div>
  );
}

function TagGroup({
  label,
  values,
  variant,
}: {
  label: string;
  values: string[];
  variant: 'info' | 'muted' | 'outline';
}) {
  if (values.length === 0) return null;
  return (
    <div className="flex items-center gap-1.5">
      <FieldLabel>{label}</FieldLabel>
      <div className="flex flex-wrap gap-1">
        {values.map((v) => (
          <Badge key={v} variant={variant}>
            {v}
          </Badge>
        ))}
      </div>
    </div>
  );
}
