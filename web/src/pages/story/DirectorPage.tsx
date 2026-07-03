import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Clapperboard, Loader2, Play, X } from 'lucide-react';
import { useStories } from '@/api/stories';
import { useAssignments, useCreateAssignment } from '@/api/director';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Separator } from '@/components/ui/separator';
import { formatDate } from '@/lib/utils';
import type { AssignmentWithStatus, CreateAssignmentBody, StorySummary } from '@/types/story';

// 默认值与后端 defaultAssignment 保持一致
const DEFAULT_STYLE_NOTES = ['短剧节奏', '强开场钩子', '冲突可视化'];
const DEFAULT_CONSTRAINTS = ['不得改写故事边界', '不得加入未被来源支持的重大事实'];

const OBJECTIVE_LABEL: Record<string, string> = {
  draft_script: '草拟剧本',
  revise_script: '修订剧本',
  create_storyboard_prompts: '生成分镜提示词',
};

export function DirectorPage() {
  const { bookId = '' } = useParams();
  const storiesQ = useStories(bookId);
  const approvedStories = (storiesQ.data?.stories ?? []).filter((s) => s.approved);

  return (
    <div className="space-y-6">
      <AssignmentForm bookId={bookId} approvedStories={approvedStories} />
      <Separator />
      <AssignmentHistory bookId={bookId} stories={storiesQ.data?.stories ?? []} />
    </div>
  );
}

// ---------- 创建表单 ----------

function AssignmentForm({
  bookId,
  approvedStories,
}: {
  bookId: string;
  approvedStories: StorySummary[];
}) {
  const createM = useCreateAssignment(bookId);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [objective, setObjective] =
    useState<CreateAssignmentBody['objective']>('draft_script');
  const [styleNotes, setStyleNotes] = useState<string[]>(DEFAULT_STYLE_NOTES);
  const [constraints, setConstraints] = useState<string[]>(DEFAULT_CONSTRAINTS);

  const toggleStory = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const disabled = approvedStories.length === 0;
  const assignmentType = selectedIds.length > 1 ? 'story_batch' : 'single_story';

  const submit = () => {
    if (selectedIds.length === 0) {
      toast.error('请至少选择一个已审批的故事段');
      return;
    }
    createM.mutate(
      { assignmentType, storyIds: selectedIds, objective, styleNotes, constraints },
      {
        onSuccess: (record) => {
          if (record.status === 'completed') {
            toast.success('导演任务完成，剧本与提示词包已生成');
          } else {
            toast.error(`导演任务部分失败：${record.error ?? '未知错误'}`);
          }
          setSelectedIds([]);
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
      },
    );
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">新建导演任务</h2>
        <p className="text-xs text-muted-foreground">
          选择已审批的故事段，导演管线将生成剧集规划、剧本、剧本审核、分镜与视频提示词包。
        </p>
      </div>

      {disabled ? (
        <div className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          还没有已审批的故事段。请先到
          <Link className="mx-1 underline" to={`/books/${bookId}/stories`}>
            故事页
          </Link>
          审批至少一段。
        </div>
      ) : (
        <div className="space-y-4 rounded-lg border bg-card p-4">
          <div className="space-y-2">
            <Label>
              选择故事（{selectedIds.length} 已选 · 多选自动按批量任务处理）
            </Label>
            <div className="grid max-h-56 grid-cols-1 gap-1 overflow-y-auto md:grid-cols-2">
              {approvedStories.map((s) => (
                <label
                  key={s.id}
                  className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors hover:bg-accent/50"
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={selectedIds.includes(s.id)}
                    onChange={() => toggleStory(s.id)}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    第{s.startChapter}-{s.endChapter}章 {s.title}
                  </span>
                  {s.directorRan && <Badge variant="muted">已有剧本</Badge>}
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>目标</Label>
            <RadioGroup
              value={objective}
              onValueChange={(v) => setObjective(v as CreateAssignmentBody['objective'])}
              className="flex flex-wrap gap-4"
            >
              {(Object.keys(OBJECTIVE_LABEL) as CreateAssignmentBody['objective'][]).map((o) => (
                <div key={o} className="flex items-center gap-1.5">
                  <RadioGroupItem value={o} id={`obj-${o}`} />
                  <Label htmlFor={`obj-${o}`} className="cursor-pointer font-normal">
                    {OBJECTIVE_LABEL[o]}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>

          <TagListInput label="风格笔记" values={styleNotes} onChange={setStyleNotes} />
          <TagListInput label="约束" values={constraints} onChange={setConstraints} />

          <div className="flex justify-end">
            <Button disabled={createM.isPending || selectedIds.length === 0} onClick={submit}>
              {createM.isPending ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Play className="mr-1.5 h-4 w-4" />
              )}
              创建并运行
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function TagListInput({
  label,
  values,
  onChange,
}: {
  label: string;
  values: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState('');

  const add = () => {
    const text = draft.trim();
    if (!text || values.includes(text)) return;
    onChange([...values, text]);
    setDraft('');
  };

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex flex-wrap items-center gap-1.5">
        {values.map((v) => (
          <Badge key={v} variant="secondary" className="gap-1">
            {v}
            <button type="button" onClick={() => onChange(values.filter((x) => x !== v))}>
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          onBlur={add}
          placeholder="输入后回车添加"
          className="h-7 w-40 text-xs"
        />
      </div>
    </div>
  );
}

// ---------- 任务历史 ----------

function AssignmentHistory({
  bookId,
  stories,
}: {
  bookId: string;
  stories: StorySummary[];
}) {
  const assignmentsQ = useAssignments(bookId);
  const assignments = assignmentsQ.data?.assignments ?? [];

  const storyTitle = (id: string) =>
    stories.find((s) => s.id === id)?.title ?? id.slice(0, 20);

  return (
    <div className="space-y-3">
      <h3 className="text-base font-semibold">任务历史</h3>
      {assignmentsQ.isLoading ? (
        <p className="text-sm text-muted-foreground">加载中…</p>
      ) : assignments.length === 0 ? (
        <p className="text-sm text-muted-foreground">还没有运行过导演任务。</p>
      ) : (
        <div className="space-y-2">
          {assignments.map((a) => (
            <AssignmentRow key={a.id} bookId={bookId} assignment={a} storyTitle={storyTitle} />
          ))}
        </div>
      )}
    </div>
  );
}

function AssignmentRow({
  bookId,
  assignment,
  storyTitle,
}: {
  bookId: string;
  assignment: AssignmentWithStatus;
  storyTitle: (id: string) => string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card px-4 py-2.5">
      <Clapperboard className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">
          <span className="font-mono text-xs text-muted-foreground">
            #{assignment.id.replace('assignment-', '')}
          </span>{' '}
          {assignment.storyIds.map(storyTitle).join('、')} ·{' '}
          {OBJECTIVE_LABEL[assignment.objective] ?? assignment.objective}
        </p>
        <p className="text-xs text-muted-foreground">
          {formatDate(assignment.createdAt)}
          {assignment.error && <span className="text-destructive"> · {assignment.error}</span>}
        </p>
      </div>
      <Badge variant={assignment.status === 'completed' ? 'success' : 'destructive'}>
        {assignment.status === 'completed' ? '完成' : '失败'}
      </Badge>
      {assignment.status === 'completed' && assignment.storyIds[0] && (
        <Button size="sm" variant="outline" asChild>
          <Link to={`/books/${bookId}/stories/${assignment.storyIds[0]}/episodes`}>查看产物 →</Link>
        </Button>
      )}
    </div>
  );
}
