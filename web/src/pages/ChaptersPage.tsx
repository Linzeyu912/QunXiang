import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { AlertTriangle, ListTree, Zap } from 'lucide-react';
import { useChapterOutline, useExtractionArtifacts } from '@/api/artifacts';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { ChapterNoiseLine, NarrativeEventEntry, NoiseCategory } from '@/types';

const NOISE_LABEL: Record<NoiseCategory, string> = {
  url: '链接',
  promo: '推广',
  template: '模板',
  decoration: '装饰',
  repeated: '重复',
  garbled: '乱码',
  meta: '元信息',
};

/**
 * 章节结构视图：可视化提取管线第一步（预处理 + 结构化切章）的真实结果，
 * 并把最新运行提取到的叙事事件按章标注。
 */
export function ChaptersPage() {
  const { bookId = '' } = useParams();
  const outlineQ = useChapterOutline(bookId);
  const artifactsQ = useExtractionArtifacts(bookId);

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

  if (outlineQ.isLoading) {
    return <p className="p-6 text-sm text-muted-foreground">解析章节结构…</p>;
  }
  if (!outline) {
    return <p className="p-6 text-sm text-muted-foreground">无法解析该书的章节结构。</p>;
  }

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
          </p>
        </div>
        <div className="flex items-center gap-2">
          {outline.isFallback ? (
            <Badge variant="warning">兜底切章（未识别到章节标记，按固定长度切分）</Badge>
          ) : (
            <Badge variant="success">切章模式：{outline.chapterMode}</Badge>
          )}
          {(artifactsQ.data?.events.length ?? 0) > 0 && (
            <Badge variant="info">
              <Zap className="mr-1 h-3 w-3" />
              {artifactsQ.data!.events.length} 个叙事事件
            </Badge>
          )}
        </div>
      </div>

      {outline.suspectLines.length > 0 && <NoiseLinesPanel lines={outline.suspectLines} />}

      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="grid grid-cols-[3.5rem_minmax(0,1fr)_minmax(8rem,20%)_5rem] items-center gap-2 border-b bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground">
          <span>章</span>
          <span>标题 / 叙事事件</span>
          <span>篇幅</span>
          <span className="text-right">字数</span>
        </div>
        <TooltipProvider delayDuration={200}>
          <div className="max-h-[calc(100vh-20rem)] overflow-y-auto">
            {outline.chapters.map((ch) => {
              const events = eventsByChapter.get(ch.index) ?? [];
              return (
                <div
                  key={ch.index}
                  className="grid grid-cols-[3.5rem_minmax(0,1fr)_minmax(8rem,20%)_5rem] items-center gap-2 border-b px-4 py-2 text-sm last:border-b-0 hover:bg-accent/30"
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
                </div>
              );
            })}
          </div>
        </TooltipProvider>
      </div>
    </div>
  );
}

function NoiseLinesPanel({ lines }: { lines: ChapterNoiseLine[] }) {
  const removedCount = lines.filter((line) => line.removed).length;
  const retainedCount = lines.length - removedCount;
  const byCategory = lines.reduce<Partial<Record<NoiseCategory, number>>>((acc, line) => {
    acc[line.category] = (acc[line.category] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <details className="overflow-hidden rounded-lg border bg-card" open={removedCount > 0}>
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 border-b bg-muted/30 px-4 py-2 text-sm font-medium">
        <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        噪声过滤明细
        <Badge variant="warning">{removedCount} 行已移除</Badge>
        {retainedCount > 0 && <Badge variant="muted">{retainedCount} 行仅标记</Badge>}
        <span className="text-xs font-normal text-muted-foreground">
          {Object.entries(byCategory)
            .map(([category, count]) => `${NOISE_LABEL[category as NoiseCategory]} ${count}`)
            .join(' · ')}
        </span>
      </summary>
      <div className="overflow-x-auto">
        <div className="grid min-w-[48rem] grid-cols-[4rem_5rem_5rem_5rem_minmax(0,1fr)] items-center gap-2 border-b bg-muted/20 px-4 py-2 text-xs font-medium text-muted-foreground">
          <span>原行号</span>
          <span>类型</span>
          <span>置信</span>
          <span>动作</span>
          <span>内容</span>
        </div>
        <div className="max-h-64 overflow-y-auto">
          {lines.map((line) => (
            <div
              key={`${line.lineNum}-${line.category}-${line.content}`}
              className="grid min-w-[48rem] grid-cols-[4rem_5rem_5rem_5rem_minmax(0,1fr)] items-center gap-2 border-b px-4 py-2 text-xs last:border-b-0"
            >
              <span className="font-mono text-muted-foreground">{line.lineNum}</span>
              <span>{NOISE_LABEL[line.category]}</span>
              <span className="font-mono text-muted-foreground">{line.confidence.toFixed(2)}</span>
              <span>
                <Badge variant={line.removed ? 'warning' : 'muted'}>
                  {line.removed ? '已移除' : '仅标记'}
                </Badge>
              </span>
              <span className="truncate text-muted-foreground">{line.content}</span>
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}
