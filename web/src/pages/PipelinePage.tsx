import { useEffect, useRef } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertCircle, CheckCircle2, FileSearch, Loader2, Play } from 'lucide-react';
import { useStages, useExtractionStream, useResumeExtraction, useRunEstimate, useCreateRun, useCurrentRun, useRunAction } from '@/api/extraction';
import { useExtractionArtifacts, useExtractionRuns, usePrescanArtifacts } from '@/api/artifacts';
import { useLlmStatus } from '@/api/llm';
import { Badge } from '@/components/ui/badge';
import { formatDate } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
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
  const resume = useResumeExtraction(bookId);
  const createRun = useCreateRun(bookId);
  const pauseRun = useRunAction(bookId, 'pause');
  const resumeRun = useRunAction(bookId, 'resume');
  const cancelRun = useRunAction(bookId, 'cancel');
  const extractionGate = getExtractionStartGate(llm.data, llm.isLoading);

  const isRunning = stages.data?.isRunning && !stages.data?.isComplete;
  const estimateQ = useRunEstimate(bookId, !isRunning && !stages.data?.isComplete);
  const currentRunQ = useCurrentRun(bookId, true);
  const activeRun = currentRunQ.data?.run
    && ['QUEUED', 'RUNNING', 'PAUSING', 'PAUSED', 'CANCELLING'].includes(currentRunQ.data.run.status)
    ? currentRunQ.data.run
    : null;
  useExtractionStream(bookId, !!isRunning);

  // 用 ref 而非 state 做一次性哨兵：StrictMode 下 effect 会被双重调用，
  // 但 ref 在两次调用之间保持同一个引用，能防止重复触发 /extract。
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (autoStartedRef.current) return;
    if (sp.get('autostart') !== '1') return;
    if (stages.isLoading || llm.isLoading) return;

    autoStartedRef.current = true;
    if (!stages.data?.isRunning && !stages.data?.isComplete) {
      void handleStart();
    }
    const next = new URLSearchParams(sp);
    next.delete('autostart');
    setSp(next, { replace: true });
    // handleStart intentionally reads the latest gate state after LLM status settles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [llm.isLoading, sp, setSp, stages.data?.isRunning, stages.isLoading]);

  async function handleStart() {
    // 防重入：确认弹窗的「确认重新提取」不受按钮 disabled 约束，这里兜底
    if (createRun.isPending) return;
    if (!extractionGate.canStart) {
      toast.error(extractionGate.title ?? 'LLM 服务商未配置', {
        description: extractionGate.description,
        action: extractionGate.actionLabel
          ? { label: extractionGate.actionLabel, onClick: () => navigate('/settings/llm') }
          : undefined,
      });
      return;
    }
    try {
      // 新前端走运行接口（实施包 D1）：创建会话（含预算估算）并启动
      await createRun.mutateAsync();
      toast.success('运行已创建并开始提取');
    } catch (e) {
      toast.error(`触发失败：${(e as Error).message}`);
    }
  }

  if (stages.isLoading) {
    return <PipelineSkeleton />;
  }

  const data = stages.data;
  const notStarted = !data || data.stages.every((s) => s.status === 'pending');

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle>整体进度</CardTitle>
          {/* 运行状态对屏幕阅读器可见，但不逐字播报进度数字 */}
          <div aria-live="polite">
            {data?.isComplete ? (
              <span className="flex items-center gap-1 text-sm text-success">
                <CheckCircle2 className="h-4 w-4" />
                已完成
              </span>
            ) : data?.isFailed ? (
              <span className="flex items-center gap-1 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" />
                失败
              </span>
            ) : isRunning ? (
              <span className="flex items-center gap-1 text-sm text-info">
                <Loader2 className="h-4 w-4 animate-spin" />
                进行中
              </span>
            ) : (
              <span className="text-sm text-muted-foreground">未开始</span>
            )}
          </div>
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

      {data?.imported && (
        <Card className="border-info/40 bg-info/10 p-4 text-sm text-info">
          {data.importedMessage ?? '这是导入结果，没有本机提取阶段记录。'}
        </Card>
      )}

      {activeRun && activeRun.status !== 'COMPLETED' && (
        <Card className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm">
              <span className="font-medium">当前运行</span>
              <span className="ml-2 text-muted-foreground">
                {activeRun.status === 'PAUSED' ? '已暂停' : activeRun.status === 'PAUSING' ? '暂停中（等待当前调用完成）' : activeRun.status === 'CANCELLING' ? '取消中' : '进行中'}
                {activeRun.pauseRequestedAt && ' · 已请求暂停'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {['RUNNING', 'QUEUED', 'PAUSING'].includes(activeRun.status) && (
                <Button size="sm" variant="outline" disabled={pauseRun.isPending}
                  onClick={() => pauseRun.mutate(activeRun.id, { onSuccess: (r) => toast.success(r.message), onError: (e) => toast.error((e as Error).message) })}>
                  暂停
                </Button>
              )}
              {activeRun.status === 'PAUSED' && (
                <Button size="sm" variant="outline" disabled={resumeRun.isPending}
                  onClick={() => resumeRun.mutate(activeRun.id, { onSuccess: (r) => toast.success(r.message), onError: (e) => toast.error((e as Error).message) })}>
                  恢复
                </Button>
              )}
              {!['CANCELLED', 'COMPLETED', 'FAILED'].includes(activeRun.status) && (
                <Button size="sm" variant="ghost" className="text-destructive" disabled={cancelRun.isPending}
                  onClick={() => cancelRun.mutate(activeRun.id, { onSuccess: (r) => toast.success(r.message), onError: (e) => toast.error((e as Error).message) })}>
                  取消
                </Button>
              )}
            </div>
          </div>
        </Card>
      )}

      {notStarted && (
        <Card className="p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">这本书还没开始提取</p>
              <p className="text-xs text-muted-foreground">点击开始运行 6 阶段管道</p>
              {estimateQ.data && (
                <p className="mt-1 text-xs text-muted-foreground">
                  原文 {estimateQ.data.inputChars.toLocaleString()} 字 · 预计调用 {estimateQ.data.estimatedCalls} 次
                  {estimateQ.data.queuedAhead > 0 && ` · 队列前方 ${estimateQ.data.queuedAhead} 个运行`}
                  {estimateQ.data.historicalDurationMs != null && ` · 历史平均约 ${Math.round(estimateQ.data.historicalDurationMs / 60000)} 分钟`}
                  {` · 本次调用上限 ${estimateQ.data.maxCalls} 次`}
                </p>
              )}
            </div>
            <Button onClick={handleStart} disabled={createRun.isPending || !extractionGate.canStart} className="gap-2">
              {createRun.isPending ? (
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
        <Card className="border-success/40 bg-success/10 p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-success">提取完成</p>
              <p className="text-xs text-success/80">可以开始审核角色/场景/道具</p>
            </div>
            <div className="flex items-center gap-2">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    disabled={createRun.isPending || !extractionGate.canStart}
                    title="重新运行完整管道，生成新一轮产物并设为当前生效运行"
                  >
                    重新提取
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>重新提取？</AlertDialogTitle>
                    <AlertDialogDescription>
                      将重新运行完整管道，生成新一轮的实体与产物，并设为当前生效运行，覆盖实体审核页和导出所读取的数据。原有的审核状态可能无法对应到新实体，请确认后再继续。
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>取消</AlertDialogCancel>
                    <AlertDialogAction onClick={handleStart}>确认重新提取</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <Button onClick={() => navigate(`/books/${bookId}/characters`)}>开始审核 →</Button>
            </div>
          </div>
        </Card>
      )}

      {data?.isComplete && <ExtractionSummaryCard bookId={bookId} />}

      <RunsHistoryCard bookId={bookId} />

      <PrescanArtifactsCard bookId={bookId} />

      {data?.isFailed && (
        <Card className="border-destructive/40 bg-destructive/5 p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-destructive">提取失败</p>
              <p className="text-xs text-destructive/80">查看失败阶段的错误信息，修复后可再次触发或从失败处继续</p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => resume.mutate()}
                disabled={resume.isPending || createRun.isPending || !extractionGate.canStart}
                title="从第一个失败的 stage 继续，已成功的 stage 不重跑"
              >
                {resume.isPending ? '恢复中…' : '从失败处继续'}
              </Button>
              <Button variant="destructive" onClick={handleStart} disabled={createRun.isPending || resume.isPending || !extractionGate.canStart}>
                重新开始
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

function LlmGateNotice({ gate, onSettings }: { gate: ExtractionStartGate; onSettings: () => void }) {
  if (gate.canStart) return null;

  return (
    <Card className="border-warning/40 bg-warning/10 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <div>
            <p className="text-sm font-medium text-warning">{gate.title}</p>
            <p className="mt-0.5 text-xs text-warning/80">{gate.description}</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={onSettings} className="shrink-0">
          {gate.actionLabel ?? '去设置'}
        </Button>
      </div>
    </Card>
  );
}

/** 实体预扫描中间产物（regex/LLM 命中），用于解释后续提取输入。 */
function PrescanArtifactsCard({ bookId }: { bookId: string }) {
  const prescanQ = usePrescanArtifacts(bookId);
  const data = prescanQ.data;
  if (!data?.available) return null;

  const total = PRESCAN_TYPES.reduce((sum, type) => sum + data.files[type].totalCount, 0);

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

/** 管道页加载骨架：整体进度卡 + 6 张阶段卡占位，贴合真实布局。 */
function PipelineSkeleton() {
  return (
    <div className="space-y-6" aria-label="管道进度加载中">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-4 w-14" />
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-2 w-full" />
          <Skeleton className="h-3 w-32" />
        </CardContent>
      </Card>
      <div className="grid gap-3 md:grid-cols-2">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Card key={i} className="p-4">
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-5 w-14" />
            </div>
            <Skeleton className="mt-3 h-3 w-full" />
            <Skeleton className="mt-2 h-3 w-3/5" />
          </Card>
        ))}
      </div>
    </div>
  );
}
