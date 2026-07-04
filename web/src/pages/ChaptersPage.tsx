import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertTriangle, ListTree, RotateCcw, Undo2, Zap } from 'lucide-react';
import { useChapterOutline, useExtractionArtifacts, useRestoreNoiseLine } from '@/api/artifacts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChapterReader } from '@/components/chapter/ChapterReader';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { ChapterNoiseLine, NarrativeEventEntry, NoiseCategory } from '@/types';

export const NOISE_LABEL: Record<NoiseCategory, string> = {
  url: '链接',
  promo: '推广',
  template: '模板',
  decoration: '装饰',
  repeated: '重复',
  garbled: '乱码',
  meta: '元信息',
};

const CHAPTER_MODE_LABEL: Record<string, string> = {
  chapter_zh: '中文章节标记',
  chapter_en: '英文章节标记',
  heuristic: '启发式',
  fixed: '固定长度',
};

/**
 * 章节结构视图：可视化提取管线第一步（预处理 + 结构化切章）的真实结果，
 * 并把最新运行提取到的叙事事件按章标注。
 */
export function ChaptersPage() {
  const { bookId = '' } = useParams();
  const outlineQ = useChapterOutline(bookId);
  const artifactsQ = useExtractionArtifacts(bookId);
  const [selectedChapter, setSelectedChapter] = useState<number | null>(null);

  const outline = outlineQ.data;

  const eventsByChapter = useMemo(() => {
    const map = new Map<number, NarrativeEventEntry[]>();
    for (const e of artifactsQ.data?.events ?? []) {
      const list = map.get(e.chapterIndex) ?? [];
      list.push(e);
      map.set(e.chapterIndex, list);
    }
    return map;
  }, [artifactsQ.data]);

  const maxWords = useMemo(
    () => Math.max(1, ...(outline?.chapters.map((c) => c.wordCount) ?? [1])),
    [outline],
  );
  const totalWords = useMemo(
    () => (outline?.chapters ?? []).reduce((acc, c) => acc + c.wordCount, 0),
    [outline],
  );
  const restoredCount = useMemo(
    () => (outline?.suspectLines ?? []).filter((l) => l.restored).length,
    [outline],
  );

  if (outlineQ.isLoading) {
    return <p className="p-6 text-sm text-muted-foreground">解析章节结构…</p>;
  }
  if (!outline) {
    return <p className="p-6 text-sm text-muted-foreground">无法解析该书的章节结构。</p>;
  }

  const selChapter = selectedChapter ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <ListTree className="h-5 w-5 text-muted-foreground" />
            章节结构
          </h2>
          <p className="text-xs text-muted-foreground">
            {outline.chapters.length} 章 · 共 {totalWords.toLocaleString()} 字
            {outline.removedNoiseLines > 0 && ` · 预处理清理了 ${outline.removedNoiseLines} 行噪声`}
            {restoredCount > 0 && ` · 已找回 ${restoredCount} 行`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {outline.isFallback ? (
            <Badge variant="warning">兜底切章（未识别到章节标记，按固定长度切分）</Badge>
          ) : (
            <Badge variant="success">切章模式：{CHAPTER_MODE_LABEL[outline.chapterMode] ?? outline.chapterMode}</Badge>
          )}
          {(artifactsQ.data?.events.length ?? 0) > 0 && (
            <Badge variant="info">
              <Zap className="mr-1 h-3 w-3" />
              {artifactsQ.data!.events.length} 个叙事事件
            </Badge>
          )}
        </div>
      </div>

      {outline.suspectLines.length > 0 && (
        <NoiseLinesPanel
          bookId={bookId}
          lines={outline.suspectLines}
          totalSuspect={outline.suspectLinesTotal}
          totalRemoved={outline.removedNoiseLines}
          byCategory={outline.byCategory}
        />
      )}

      {/* 双栏：左章节列表，右正文阅读视图。两栏独立滚动，互不影响高度。 */}
      <div className="grid h-[calc(100vh-16rem)] grid-cols-[minmax(280px,2fr)_minmax(0,3fr)] grid-rows-1 overflow-hidden rounded-lg border bg-card">
        <div className="flex h-full min-h-0 flex-col overflow-hidden border-r">
          <div className="grid grid-cols-[3.5rem_minmax(0,1fr)_minmax(5rem,16%)_4.5rem] items-center gap-2 border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
            <span>章</span>
            <span>标题 / 叙事事件</span>
            <span>篇幅</span>
            <span className="text-right">字数</span>
          </div>
          <TooltipProvider delayDuration={200}>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {outline.chapters.map((ch) => {
                const events = eventsByChapter.get(ch.index) ?? [];
                const active = ch.index === selChapter;
                return (
                  <button
                    key={ch.index}
                    type="button"
                    onClick={() => setSelectedChapter(ch.index)}
                    className={cn(
                      'grid w-full grid-cols-[3.5rem_minmax(0,1fr)_minmax(5rem,16%)_4.5rem] items-center gap-2 border-b px-3 py-2 text-left text-sm last:border-b-0',
                      active ? 'bg-accent' : 'hover:bg-accent/30',
                    )}
                  >
                    <span className="font-mono text-xs text-muted-foreground">{ch.index + 1}</span>
                    <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                      <span className="truncate">{ch.title || '（无标题）'}</span>
                      {events.map((e, i) => (
                        <Tooltip key={i}>
                          <TooltipTrigger asChild>
                            <span>
                              <Badge
                                variant="info"
                                className={cn(
                                  'cursor-default gap-0.5',
                                  e.source === 'llm' && 'bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300',
                                )}
                              >
                                <Zap className="h-2.5 w-2.5" />
                                {e.text.length > 12 ? `${e.text.slice(0, 12)}…` : e.text}
                              </Badge>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs">
                            <p className="text-xs">{e.text}</p>
                            <p className="mt-1 text-[10px] opacity-70">
                              来源 {e.source ?? '?'} · 置信 {e.confidence?.toFixed(2) ?? '?'}
                              {e.allChapters && e.allChapters.length > 1 && ` · 亦见第 ${e.allChapters.map((c) => c + 1).join('、')} 章`}
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      ))}
                    </span>
                    <span className="h-1.5 rounded-full bg-secondary">
                      <span
                        className="block h-full rounded-full bg-sky-400"
                        style={{ width: `${Math.max(2, (ch.wordCount / maxWords) * 100)}%` }}
                      />
                    </span>
                    <span className="text-right font-mono text-xs text-muted-foreground">
                      {ch.wordCount.toLocaleString()}
                    </span>
                  </button>
                );
              })}
            </div>
          </TooltipProvider>
        </div>

        {/* 右栏：正文阅读视图 */}
        <ChapterReader bookId={bookId} chapterIndex={selChapter} />
      </div>
    </div>
  );
}

function NoiseLinesPanel({
  bookId,
  lines,
  totalSuspect,
  totalRemoved,
  byCategory,
}: {
  bookId: string;
  lines: ChapterNoiseLine[];
  totalSuspect: number;
  totalRemoved: number;
  byCategory: Record<string, number>;
}) {
  const restoreM = useRestoreNoiseLine(bookId);
  const retainedTotal = totalSuspect - totalRemoved;
  const capped = totalSuspect > lines.length;
  const categoryEntries = Object.entries(byCategory).filter(([, n]) => n > 0);

  const handleToggle = (lineNum: number, currentlyRestored: boolean) => {
    restoreM.mutate(
      { lineNum, restore: !currentlyRestored },
      {
        onSuccess: () =>
          toast.success(currentlyRestored ? '已取消找回' : '已找回，该行将保留'),
        onError: (e) => toast.error(e instanceof Error ? e.message : '操作失败'),
      },
    );
  };

  return (
    <details className="overflow-hidden rounded-lg border bg-card" open={totalRemoved > 0}>
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 border-b bg-muted/30 px-4 py-2 text-sm font-medium">
        <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        噪声过滤明细
        <Badge variant="warning">{totalRemoved} 行已移除</Badge>
        {retainedTotal > 0 && <Badge variant="muted">{retainedTotal} 行仅标记</Badge>}
        <span className="text-xs font-normal text-muted-foreground">
          {categoryEntries
            .map(([category, count]) => `${NOISE_LABEL[category as NoiseCategory]} ${count}`)
            .join(' · ')}
          {capped && ` · 明细仅显示前 ${lines.length} / 共 ${totalSuspect} 条`}
        </span>
      </summary>
      <div className="overflow-x-auto">
        <div className="grid min-w-[52rem] grid-cols-[4rem_5rem_5rem_5rem_minmax(0,1fr)_6rem] items-center gap-2 border-b bg-muted/20 px-4 py-2 text-xs font-medium text-muted-foreground">
          <span>原行号</span>
          <span>类型</span>
          <span>置信</span>
          <span>动作</span>
          <span>内容</span>
          <span className="text-right">找回</span>
        </div>
        <div className="max-h-64 overflow-y-auto">
          {lines.map((line) => (
            <div
              key={`${line.lineNum}-${line.category}-${line.content}`}
              className="grid min-w-[52rem] grid-cols-[4rem_5rem_5rem_5rem_minmax(0,1fr)_6rem] items-center gap-2 border-b px-4 py-2 text-xs last:border-b-0"
            >
              <span className="font-mono text-muted-foreground">{line.lineNum}</span>
              <span>{NOISE_LABEL[line.category]}</span>
              <span className="font-mono text-muted-foreground">{line.confidence.toFixed(2)}</span>
              <span>
                {line.restored ? (
                  <Badge variant="success">已找回</Badge>
                ) : (
                  <Badge variant={line.removed ? 'warning' : 'muted'}>
                    {line.removed ? '已移除' : '仅标记'}
                  </Badge>
                )}
              </span>
              <span className="truncate text-muted-foreground">{line.content}</span>
              <span className="flex justify-end">
                {/* 只有「会被删」的行才能找回；仅标记行（置信<0.8）本就不会删，无需找回 */}
                {(line.removed || line.restored) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1 px-2"
                    disabled={restoreM.isPending}
                    onClick={() => handleToggle(line.lineNum, !!line.restored)}
                  >
                    {line.restored ? (
                      <>
                        <Undo2 className="h-3 w-3" />
                        取消
                      </>
                    ) : (
                      <>
                        <RotateCcw className="h-3 w-3" />
                        找回
                      </>
                    )}
                  </Button>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}
