import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Clapperboard, Download, FileText, Film, Video } from 'lucide-react';
import { useStoryDetail } from '@/api/stories';
import { useEpisodes, useStoryboard, useVideoPrompts } from '@/api/director';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PromptCopyBlock, downloadJson } from '@/components/story/PromptCopyBlock';
import { ScriptReviewBar } from '@/components/story/ScriptReviewBar';
import type {
  ScriptEpisode,
  ScriptEpisodePlan,
  ScriptReview,
  ScriptScene,
  StoryboardFramePrompt,
  VideoClipPrompt,
} from '@/types/story';

const SHOT_LABEL: Record<string, string> = {
  establishing: '定场',
  wide: '全景',
  medium: '中景',
  close_up: '特写',
  insert: '插入',
  over_shoulder: '过肩',
  reaction: '反应',
};

export function EpisodesPage() {
  const { bookId = '', storyId = '' } = useParams();
  const storyQ = useStoryDetail(bookId, storyId);
  const episodesQ = useEpisodes(bookId, storyId);

  const data = episodesQ.data;
  const [selectedEp, setSelectedEp] = useState<number | null>(null);
  const episodes = data?.episodes ?? [];
  const currentEp =
    episodes.find((e) => e.episodeNo === selectedEp) ?? episodes[0] ?? null;
  const currentEpNo = currentEp?.episodeNo ?? null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" asChild>
          <Link to={`/books/${bookId}/stories?sel=${storyId}`} aria-label="返回故事列表">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold">剧集与产物</h2>
          <p className="text-xs text-muted-foreground">
            {storyQ.data ? storyQ.data.title : '加载中…'}
          </p>
        </div>
        <SourceTextDialog bookId={bookId} storyId={storyId} title={storyQ.data?.title} />
      </div>

      {episodesQ.isLoading ? (
        <p className="p-6 text-sm text-muted-foreground">加载中…</p>
      ) : !data?.hasDirectorRun ? (
        <div className="flex h-[40vh] flex-col items-center justify-center gap-3 rounded-lg border border-dashed">
          <Clapperboard className="h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">该故事段还没有运行过导演任务。</p>
          <Button asChild>
            <Link to={`/books/${bookId}/director`}>去导演工作台创建任务</Link>
          </Button>
        </div>
      ) : (
        <Tabs defaultValue="script">
          <TabsList>
            <TabsTrigger value="plans">规划 {data.plans.length}</TabsTrigger>
            <TabsTrigger value="script">剧本 {episodes.length}</TabsTrigger>
            <TabsTrigger value="storyboard">分镜提示词</TabsTrigger>
            <TabsTrigger value="video">视频提示词</TabsTrigger>
          </TabsList>

          <TabsContent value="plans">
            <PlansPane plans={data.plans} />
          </TabsContent>

          <TabsContent value="script">
            <ScriptPane
              episodes={episodes}
              review={data.review}
              currentEp={currentEp}
              onSelectEp={setSelectedEp}
            />
          </TabsContent>

          <TabsContent value="storyboard">
            <StoryboardPane bookId={bookId} storyId={storyId} episodeNo={currentEpNo} />
          </TabsContent>

          <TabsContent value="video">
            <VideoPane bookId={bookId} storyId={storyId} episodeNo={currentEpNo} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

// ---------- 原文对话框（供剧本对照来源引用） ----------

function SourceTextDialog({
  bookId,
  storyId,
  title,
}: {
  bookId: string;
  storyId: string;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const sourceQ = useStoryDetail(bookId, open ? storyId : undefined, true);
  const sourceText = (sourceQ.data as { sourceText?: string } | undefined)?.sourceText;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <FileText className="mr-1.5 h-4 w-4" />
          查看原文
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title ?? '故事原文'}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] overflow-y-auto rounded-md bg-muted/40 p-4">
          {sourceQ.isLoading ? (
            <p className="text-sm text-muted-foreground">加载原文…</p>
          ) : (
            <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
              {sourceText ?? '（无法加载原文）'}
            </pre>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------- 规划 ----------

function PlansPane({ plans }: { plans: ScriptEpisodePlan[] }) {
  if (plans.length === 0)
    return <p className="p-6 text-sm text-muted-foreground">没有剧集规划。</p>;
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {plans.map((p) => (
        <div key={p.episodeNo} className="space-y-2 rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">
              第 {p.episodeNo} 集 · {p.title}
            </span>
            <Badge variant="outline">{Math.round(p.estimatedDurationSeconds / 60)} 分钟</Badge>
          </div>
          <dl className="space-y-1 text-sm">
            <PlanRow label="开场钩子" value={p.hook} />
            <PlanRow label="本集冲突" value={p.episodeConflict} />
            <PlanRow label="转折" value={p.turningPoint} />
            <PlanRow label="结尾钩" value={p.endingButton} />
            <PlanRow label="来源" value={p.sourceRangeHint} />
          </dl>
        </div>
      ))}
    </div>
  );
}

function PlanRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-16 shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1">{value}</dd>
    </div>
  );
}

// ---------- 剧本 ----------

function ScriptPane({
  episodes,
  review,
  currentEp,
  onSelectEp,
}: {
  episodes: ScriptEpisode[];
  review: ScriptReview | null;
  currentEp: ScriptEpisode | null;
  onSelectEp: (ep: number) => void;
}) {
  if (!currentEp)
    return <p className="p-6 text-sm text-muted-foreground">没有生成剧本。</p>;

  return (
    <div className="space-y-4">
      {episodes.length > 1 && (
        <div className="flex gap-1">
          {episodes.map((e) => (
            <Button
              key={e.episodeNo}
              size="sm"
              variant={e.episodeNo === currentEp.episodeNo ? 'secondary' : 'ghost'}
              onClick={() => onSelectEp(e.episodeNo)}
            >
              第 {e.episodeNo} 集
            </Button>
          ))}
        </div>
      )}

      {review && review.episodeNo === currentEp.episodeNo && <ScriptReviewBar review={review} />}

      <div className="space-y-4 rounded-lg border bg-card p-4">
        <div>
          <h3 className="text-base font-semibold">
            第 {currentEp.episodeNo} 集 · {currentEp.title}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            时长约 {Math.round(currentEp.durationSeconds / 60)} 分钟
          </p>
          <p className="mt-2 text-sm">
            <span className="text-xs text-muted-foreground">开场钩子：</span>
            {currentEp.hook}
          </p>
          <p className="text-sm">
            <span className="text-xs text-muted-foreground">核心冲突：</span>
            {currentEp.coreConflict}
          </p>
        </div>

        <Separator />

        {currentEp.scenes.map((scene) => (
          <SceneCard key={scene.sceneNo} scene={scene} />
        ))}

        <Separator />

        <div className="space-y-1.5 text-sm">
          <p>
            <span className="text-xs text-muted-foreground">结尾钩：</span>
            {currentEp.endingButton}
          </p>
          {currentEp.directorNotes.length > 0 && (
            <div className="text-xs text-muted-foreground">
              导演笔记：{currentEp.directorNotes.join('；')}
            </div>
          )}
          {currentEp.sourceReferences.length > 0 && (
            <div className="text-xs text-muted-foreground">
              来源引用：{currentEp.sourceReferences.join('；')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SceneCard({ scene }: { scene: ScriptScene }) {
  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Badge variant="default">场 {scene.sceneNo}</Badge>
        <span className="text-sm font-medium">{scene.location}</span>
        {scene.characters.map((c) => (
          <Badge key={c} variant="info">
            {c}
          </Badge>
        ))}
        {scene.camera && (
          <span className="ml-auto text-xs text-muted-foreground">📷 {scene.camera}</span>
        )}
      </div>
      <p className="text-sm leading-relaxed">{scene.action}</p>
      {scene.dialogue.length > 0 && (
        <div className="mt-2 space-y-1 border-l-2 border-muted pl-3">
          {scene.dialogue.map((d, i) => (
            <p key={i} className="text-sm">
              <span className="font-semibold">{d.speaker}</span>
              {d.emotion && <span className="ml-1 text-xs text-muted-foreground">({d.emotion})</span>}
              ：{d.line}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- 分镜提示词 ----------

function StoryboardPane({
  bookId,
  storyId,
  episodeNo,
}: {
  bookId: string;
  storyId: string;
  episodeNo: number | null;
}) {
  const packQ = useStoryboard(bookId, storyId, episodeNo);
  const res = packQ.data;

  if (packQ.isLoading) return <p className="p-6 text-sm text-muted-foreground">加载中…</p>;
  if (!res?.pack) return <BlockedState reason={res?.reason} review={res?.review ?? null} />;

  const pack = res.pack;
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3 rounded-lg border bg-card p-3">
        <div className="min-w-0 space-y-1 text-sm">
          <p className="font-medium">
            <Film className="mr-1 inline h-4 w-4" />
            视觉连续性 · {pack.storyTitle} / {pack.episodeTitle}
          </p>
          <p className="text-xs text-muted-foreground">{pack.visualContinuity.styleGuide}</p>
          <div className="flex flex-wrap gap-1">
            {[...pack.visualContinuity.characterRefs, ...pack.visualContinuity.sceneRefs, ...pack.visualContinuity.propRefs].map(
              (r, i) => (
                <Badge key={i} variant="outline">
                  {r}
                </Badge>
              ),
            )}
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => downloadJson(pack, `storyboard-${storyId}-ep${pack.episodeNo}.json`)}
        >
          <Download className="mr-1.5 h-4 w-4" />
          下载整包
        </Button>
      </div>

      {pack.productionBoardPrompt && (
        <div className="rounded-lg border bg-card p-3">
          <PromptCopyBlock label="16:9 制作板总提示词" prompt={pack.productionBoardPrompt} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {pack.frames.map((f) => (
          <FrameCard key={f.frameNo} frame={f} />
        ))}
      </div>
    </div>
  );
}

function FrameCard({ frame }: { frame: StoryboardFramePrompt }) {
  return (
    <div className="space-y-2 rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="default">帧 {frame.frameNo}</Badge>
        <Badge variant="outline">{SHOT_LABEL[frame.shotType] ?? frame.shotType}</Badge>
        <span className="text-xs text-muted-foreground">场 {frame.sceneNo} · {frame.location}</span>
      </div>
      <p className="text-sm">{frame.narrativeBeat}</p>
      <p className="text-xs text-muted-foreground">
        {frame.characters.join('、')} · {frame.emotion} · 📷 {frame.camera}
      </p>
      <PromptCopyBlock prompt={frame.visualPrompt} negativePrompt={frame.negativePrompt} />
    </div>
  );
}

// ---------- 视频提示词 ----------

function VideoPane({
  bookId,
  storyId,
  episodeNo,
}: {
  bookId: string;
  storyId: string;
  episodeNo: number | null;
}) {
  const packQ = useVideoPrompts(bookId, storyId, episodeNo);
  const res = packQ.data;

  if (packQ.isLoading) return <p className="p-6 text-sm text-muted-foreground">加载中…</p>;
  if (!res?.pack) return <BlockedState reason={res?.reason} review={res?.review ?? null} />;

  const pack = res.pack;
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3 rounded-lg border bg-card p-3">
        <div className="min-w-0 space-y-1 text-sm">
          <p className="font-medium">
            <Video className="mr-1 inline h-4 w-4" />
            全局连续性 · {pack.storyTitle} / {pack.episodeTitle}
            {!pack.targetSkill && (
              <Badge variant="muted" className="ml-2">
                模型无关提示词
              </Badge>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {pack.globalContinuity.styleGuide}
            {pack.globalContinuity.aspectRatio && ` · ${pack.globalContinuity.aspectRatio}`}
            {pack.globalContinuity.targetDurationSeconds &&
              ` · 目标 ${pack.globalContinuity.targetDurationSeconds}s`}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => downloadJson(pack, `video-prompts-${storyId}-ep${pack.episodeNo}.json`)}
        >
          <Download className="mr-1.5 h-4 w-4" />
          下载整包
        </Button>
      </div>

      <div className="space-y-3">
        {pack.clips.map((c) => (
          <ClipCard key={c.clipNo} clip={c} />
        ))}
      </div>
    </div>
  );
}

function ClipCard({ clip }: { clip: VideoClipPrompt }) {
  return (
    <div className="space-y-2 rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="default">片段 {clip.clipNo}</Badge>
        <span>场 {clip.sceneNo}</span>
        <span>帧 {clip.sourceFrameNos.join(',')}</span>
        <Badge variant="outline">{clip.durationSeconds}s</Badge>
        <span>{clip.characters.join('、')} @ {clip.location}</span>
      </div>
      <p className="text-xs text-muted-foreground">
        运动：{clip.motion} · 镜头：{clip.cameraMovement}
      </p>
      <PromptCopyBlock prompt={clip.prompt} negativePrompt={clip.negativePrompt} />
      {clip.dialogue && clip.dialogue.length > 0 && (
        <p className="text-xs text-muted-foreground">台词：{clip.dialogue.join(' / ')}</p>
      )}
      {clip.soundNotes && clip.soundNotes.length > 0 && (
        <p className="text-xs text-muted-foreground">声音：{clip.soundNotes.join('；')}</p>
      )}
      {clip.continuityNotes.length > 0 && (
        <p className="text-xs text-muted-foreground">连续性：{clip.continuityNotes.join('；')}</p>
      )}
    </div>
  );
}

// ---------- 未生成/被阻塞态 ----------

function BlockedState({
  reason,
  review,
}: {
  reason?: 'not_generated' | 'review_blocked';
  review: ScriptReview | null;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-dashed p-6">
      {reason === 'review_blocked' && review ? (
        <>
          <p className="text-sm font-medium">剧本审核未通过，提示词包未生成。</p>
          <ScriptReviewBar review={review} />
          <p className="text-xs text-muted-foreground">
            修复故事资产或调整故事段后，重新运行导演任务即可再次生成。
          </p>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          该集的提示词包尚未生成。请先在导演工作台运行任务。
        </p>
      )}
    </div>
  );
}
