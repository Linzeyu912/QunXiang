import { useMemo } from 'react';
import { toast } from 'sonner';
import { Loader2, RotateCcw, Undo2 } from 'lucide-react';
import { useChapterContent, useRestoreNoiseLine } from '@/api/artifacts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { NOISE_LABEL } from '@/pages/ChaptersPage';
import type { ChapterNoiseLine } from '@/types';

/**
 * 单章正文阅读视图：展示清洗后的可读文本，被判定为噪声的行高亮标出，
 * 用户可逐行「找回」（保留）或「取消找回」。找回的行用绿色，被删广告用红色。
 */
export function ChapterReader({ bookId, chapterIndex }: { bookId: string; chapterIndex: number }) {
  const contentQ = useChapterContent(bookId, chapterIndex);
  const restoreM = useRestoreNoiseLine(bookId);

  const data = contentQ.data;

  // 把 noiseLines 按全文行号建索引，便于按章内行号快速查找
  const noiseByLine = useMemo(() => {
    const map = new Map<number, ChapterNoiseLine>();
    if (data) for (const n of data.noiseLines) map.set(n.lineNum, n);
    return map;
  }, [data]);

  if (contentQ.isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!data) {
    return <p className="p-6 text-sm text-muted-foreground">该章节暂无可读内容。</p>;
  }

  const lines = data.content.split('\n');

  const handleToggle = (lineNum: number, currentlyRestored: boolean) => {
    restoreM.mutate(
      { lineNum, restore: !currentlyRestored },
      {
        onSuccess: () =>
          toast.success(currentlyRestored ? '已取消找回，该行将被删除' : '已找回，该行将保留'),
        onError: (e) => toast.error(e instanceof Error ? e.message : '操作失败'),
      },
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 顶部标题 + 统计 */}
      <div className="flex items-center justify-between border-b px-4 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {data.title ?? `第 ${chapterIndex + 1} 章`}
          </p>
          <p className="text-xs text-muted-foreground">
            共 {lines.length} 行
            {data.noiseLines.length > 0 &&
              ` · 含 ${data.noiseLines.filter((n) => n.removed).length} 行待删除广告`}
          </p>
        </div>
      </div>

      {/* 正文：逐行渲染，高亮噪声行 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <div className="space-y-0.5 font-sans text-sm leading-relaxed">
          {lines.map((line, i) => {
            const fullLineNum = data.startLineNum + i;
            const noise = noiseByLine.get(fullLineNum);
            const isRestored = noise?.restored;

            if (!noise) {
              // 普通正文行
              return (
                <p key={i} className="min-h-[1em] whitespace-pre-wrap">
                  {line || '\u00A0'}
                </p>
              );
            }

            // 噪声行：高亮 + 操作按钮
            return (
              <div
                key={i}
                className={
                  'group flex items-start gap-2 rounded px-2 py-1 ' +
                  (isRestored
                    ? 'bg-emerald-100 dark:bg-emerald-500/15'
                    : 'bg-red-100 dark:bg-red-500/15')
                }
              >
                <div className="min-w-0 flex-1">
                  <p className="whitespace-pre-wrap">{line || '\u00A0'}</p>
                  <div className="mt-1 flex items-center gap-1.5">
                    <Badge variant={isRestored ? 'success' : 'warning'}>
                      {NOISE_LABEL[noise.category] ?? noise.category}
                    </Badge>
                    <span className="text-[11px] text-muted-foreground">
                      置信度 {noise.confidence.toFixed(2)}
                    </span>
                    {isRestored && (
                      <span className="text-[11px] text-emerald-700 dark:text-emerald-400">已找回</span>
                    )}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 shrink-0 px-2 opacity-60 group-hover:opacity-100"
                  disabled={restoreM.isPending}
                  onClick={() => handleToggle(fullLineNum, !!isRestored)}
                  title={isRestored ? '取消找回' : '找回此行'}
                >
                  {isRestored ? (
                    <>
                      <Undo2 className="h-3.5 w-3.5" />
                      <span className="ml-1 text-xs">取消找回</span>
                    </>
                  ) : (
                    <>
                      <RotateCcw className="h-3.5 w-3.5" />
                      <span className="ml-1 text-xs">找回</span>
                    </>
                  )}
                </Button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
