import { useEffect, useRef } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertCircle, CheckCircle2, FileSearch, Loader2, Play } from 'lucide-react';
import { useStages, useExtractionStream, useStartExtraction } from '@/api/extraction';
import { useExtractionArtifacts, useExtractionRuns, usePrescanArtifacts } from '@/api/artifacts';
import { useLlmStatus } from '@/api/llm';
import { Badge } from '@/components/ui/badge';
import { formatDate } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { StageCard } from '@/components/pipeline/StageCard';
import { getExtractionStartGate, type ExtractionStartGate } from '@/lib/extractionGate';
import type { PrescanEntityType, PrescanMentionFile } from '@/types';

const PRESCAN_TYPES: PrescanEntityType[] = ['character', 'location', 'item', 'event'];
const PRESCAN_LABEL: Record<PrescanEntityType, string> = {
  character: '角色',
  location: '场景',
  item: '道具',
  event: '事件',
};

export function PipelinePage() {
  const { bookId = '' } = useParams();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const stages = useStages(bookId);
  const llm = useLlmStatus();
  const start = useStartExtraction(bookId);
  const extractionGate = getExtractionStartGate(llm.data, llm.isLoading);

  const isRunning = stages.data?.isRunning && !stages.data?.isComplete;
  useExtractionStream(bookId, !!isRunning);

  // 用 ref 而非 state 做一次性哨兵：StrictMode 下 effect 会被双重调用，
  // 但 ref 在两次调用之间保持同一个引用，能防止重复触发 /extract。
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (autoStartedRef.current) return;
    if (sp.get('autostart') !== '1') return;
    if (stages.isLoading || llm.isLoading) return;

    autoStartedRef.current = true;
    if (!stages.data?.isRunning) {
      void handleStart();
    }
    const next = new URLSearchParams(sp);
    next.delete('autostart');
    setSp(next, { replace: true });
    // handleStart intentionally reads the latest gate state after LLM status settles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [llm.isLoading, sp, setSp, stages.data?.isRunning, stages.isLoading]);

  async function handleStart() {
    if (!extractionGate.canStart) {
      toast.error(extractionGate.title ?? 'LLM Provider 未配置', {
        description: extractionGate.description,
        action: extractionGate.actionLabel
          ? { label: extractionGate.actionLabel, onClick: () => navigate('/settings/llm') }
          : undefined,
      });
      return;
    }
    try {
      await start.mutateAsync();
      toast.success('已开始提取');
    } catch (e) {
      toast.error(`触发失败：${(e as Error).message}`);
    }
  }

  if (stages.isLoading) {
    return <p className="text-sm text-muted-foreground">加载中…</p>;
  }

  const data = stages.data;
  const notStarted = !data || data.stages.every((s) => s.status === 'pending');

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle>整体进度</CardTitle>
          {data?.isComplete ? (
            <span className="flex items-center gap-1 text-sm text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4" />
              已完成
            </span>
          ) : data?.isFailed ? (
            <span className="flex items-center gap-1 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" />
              失败
            </span>
          ) : isRunning ? (
            <span className="flex items-center gap-1 text-sm text-sky-600 dark:text-sky-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              进行中
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">未开始</span>
          )}
        </CardHeader>
        <CardContent className="space-y-2">
          <Progress value={data?.overallProgress ?? 0} />
          <p className="text-xs text-muted-foreground">
            {data?.overallProgress ?? 0}% · {data?.stages.filter((s) => s.status === 'completed').length ?? 0} /{' '}
            {data?.stages.length ?? 0} 阶段完成
          </p>
        </CardContent>
      </Card>

      <LlmGateNotice gate={extractionGate} onSettings={() => navigate('/settings/llm')} />

      {notStarted && (
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">这本书还没开始提取</p>
              <p className="text-xs text-muted-foreground">点击开始运行 6 阶段管道</p>
            </div>
            <Button onClick={handleStart} disabled={start.isPending || !extractionGate.canStart} className="gap-2">
              {start.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              开始提取
            </Button>
          </div>
        </Card>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {data?.stages.map((s) => <StageCard key={s.id} stage={s} />)}
      </div>

      {data?.isComplete && (
        <Card className="border-emerald-300 bg-emerald-50/40 p-6 dark:border-emerald-500/40 dark:bg-emerald-500/10">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">提取完成</p>
              <p className="text-xs text-emerald-700/80 dark:text-emerald-400/80">可以开始审核角色/场景/道具</p>
            </div>
            <Button onClick={() => navigate(`/books/${bookId}/characters`)}>开始审核 →</Button>
          </div>
        </Card>
      )}

      {data?.isComplete && <ExtractionSummaryCard bookId={bookId} />}

      <RunsHistoryCard bookId={bookId} />

      <PrescanArtifactsCard bookId={bookId} />

      {data?.isFailed && (
        <Card className="border-destructive/40 bg-destructive/5 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-destructive">提取失败</p>
              <p className="text-xs text-destructive/80">查看失败阶段的错误信息，修复后可再次触发</p>
            </div>
            <Button variant="destructive" onClick={handleStart} disabled={start.isPending || !extractionGate.canStart}>
              重新开始
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

function LlmGateNotice({ gate, onSettings }: { gate: ExtractionStartGate; onSettings: () => void }) {
  if (gate.canStart) return null;

  return (
    <Card className="border-amber-300 bg-amber-50/70 p-4 dark:border-amber-500/40 dark:bg-amber-500/10">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
          <div>
            <p className="text-sm font-medium text-amber-900 dark:text-amber-200">{gate.title}</p>
            <p className="mt-0.5 text-xs text-amber-800/80 dark:text-amber-300/80">{gate.description}</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={onSettings} className="shrink-0">
          {gate.actionLabel ?? '去设置'}
        </Button>
      </div>
    </Card>
  );
}

/** 实体预扫描中间产物（regex/LLM 命中、重要性评分），用于解释后续提取输入。 */
function PrescanArtifactsCard({ bookId }: { bookId: string }) {
  const prescanQ = usePrescanArtifacts(bookId);
  const data = prescanQ.data;
  if (!data?.available) return null;

  const total = PRESCAN_TYPES.reduce((sum, type) => sum + data.files[type].totalCount, 0);
  const sections = data.importance?.sections ?? [];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <FileSearch className="h-4 w-4 text-muted-foreground" />
          预扫描中间产物
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {total} 条预扫命中
          {data.intermediateDir && ` · ${data.intermediateDir}`}
          {data.generatedAt && ` · ${formatDate(data.generatedAt)}`}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 md:grid-cols-4">
          {PRESCAN_TYPES.map((type) => (
            <PrescanMentionBucket key={type} type={type} file={data.files[type]} />
          ))}
        </div>

        {sections.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">重要性评分 Top</p>
            <div className="grid gap-2 md:grid-cols-2">
              {sections.map((section) => (
                <div key={section.type} className="rounded-md border p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{PRESCAN_LABEL[section.type]}</span>
                    <Badge variant="muted">{section.rows.length} 条</Badge>
                  </div>
                  <div className="space-y-1">
                    {section.rows.slice(0, 5).map((row) => (
                      <div
                        key={`${section.type}-${row.text}-${row.importance}`}
                        className="grid grid-cols-[minmax(0,1fr)_4rem_5rem] gap-2 text-xs"
                      >
                        <span className="truncate">{row.text}</span>
                        <span className="font-mono text-muted-foreground">{row.importance.toFixed(3)}</span>
                        <Badge variant={row.route === 'main' ? 'success' : row.route === 'staging' ? 'info' : 'muted'}>
                          {row.tier}
                        </Badge>
                      </div>
                    ))}
                  </div>
                  {(section.tierSummary || section.routeSummary) && (
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      {[section.tierSummary, section.routeSummary].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {data.importance?.rawPreview && (
          <details className="rounded-md border">
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium">查看 importance.txt 原文片段</summary>
            <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap border-t bg-muted/40 p-3 text-xs leading-relaxed">
              {data.importance.rawPreview}
            </pre>
          </details>
        )}
      </CardContent>
    </Card>
  );
}

function PrescanMentionBucket({ type, file }: { type: PrescanEntityType; file: PrescanMentionFile }) {
  return (
    <div className="rounded-md border p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{PRESCAN_LABEL[type]}</span>
        <Badge variant={file.totalCount > 0 ? 'info' : 'muted'}>{file.totalCount}</Badge>
      </div>
      {file.sample.length > 0 ? (
        <div className="space-y-1">
          {file.sample.slice(0, 6).map((row) => (
            <div key={`${type}-${row.chapterIndex}-${row.text}`} className="flex items-center gap-2 text-xs">
              <span className="w-8 shrink-0 font-mono text-muted-foreground">{row.chapterIndex}</span>
              <span className="min-w-0 flex-1 truncate">{row.text}</span>
              <span className="font-mono text-muted-foreground">{row.confidence.toFixed(2)}</span>
            </div>
          ))}
          {file.totalCount > file.sample.length && (
            <p className="text-[11px] text-muted-foreground">仅显示前 {file.sample.length} 条</p>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">无命中</p>
      )}
    </div>
  );
}

/** 历次提取运行（各运行目录下 final/run-summary.json），首条为当前生效运行。 */
function RunsHistoryCard({ bookId }: { bookId: string }) {
  const runsQ = useExtractionRuns(bookId);
  const runs = runsQ.data?.runs ?? [];
  if (runs.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">运行历史</CardTitle>
        <p className="text-xs text-muted-foreground">
          共 {runs.length} 次官方运行 · 实体审核页与导出使用最新一次的产物
        </p>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {runs.map((r) => (
          <div
            key={r.runDir}
            className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-1.5 text-sm"
          >
            <span className="min-w-0 flex-1 truncate font-mono text-xs">{r.runDir}</span>
            <span className="text-xs text-muted-foreground">{formatDate(r.generatedAt)}</span>
            {r.counts && (
              <span className="text-xs text-muted-foreground">
                角色 {r.counts.characters ?? 0} / 场景 {r.counts.locations ?? 0} / 道具{' '}
                {r.counts.items ?? 0}
              </span>
            )}
            {r.isCurrent && <Badge variant="success">当前生效</Badge>}
            {r.status && r.status !== 'completed' && <Badge variant="warning">{r.status}</Badge>}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/** 最新完整运行的结果概览（entities/summary.md），无产物时不渲染。 */
function ExtractionSummaryCard({ bookId }: { bookId: string }) {
  const artifactsQ = useExtractionArtifacts(bookId);
  const data = artifactsQ.data;
  if (!data?.available || !data.summaryMd) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">提取结果概览</CardTitle>
        <p className="text-xs text-muted-foreground">
          运行目录 {data.runDir}
          {data.generatedAt && ` · ${new Date(data.generatedAt).toLocaleString()}`}
        </p>
      </CardHeader>
      <CardContent>
        <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted/50 p-3 font-sans text-xs leading-relaxed">
          {data.summaryMd}
        </pre>
      </CardContent>
    </Card>
  );
}
