import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  useAcceptCharacterMerge,
  useCharacterMergeCandidates,
  useJudgeCharacterMerges,
  useMergePreview,
  useRejectCharacterMerge,
  type MergeSuggestion,
} from '@/api/entities';
import { toast } from 'sonner';
import { Loader2, Sparkles } from 'lucide-react';

/** 模型建议标签：只展示结论与理由，不代替人工确认 */
function SuggestionBadge({ suggestion }: { suggestion?: MergeSuggestion }) {
  if (!suggestion) return null;
  const pct = Math.round(suggestion.confidence * 100);
  const label = suggestion.verdict === 'same' ? '模型建议：同一角色' : '模型建议：不同角色';
  return (
    <p className="text-xs text-violet-600">
      {label}（{pct}%）{suggestion.reason ? `——${suggestion.reason}` : ''}
    </p>
  );
}

/** 合并前字段预览（可折叠），展示将保留与合并的字段 */
function MergePreviewPanel({ bookId, primaryId, secondaryId }: { bookId: string; primaryId: string; secondaryId: string }) {
  const [open, setOpen] = useState(false);
  const preview = useMergePreview(bookId, open ? primaryId : undefined, open ? secondaryId : undefined);
  if (!open) {
    return (
      <button className="text-xs text-muted-foreground underline underline-offset-2" onClick={() => setOpen(true)}>
        查看合并后字段预览
      </button>
    );
  }
  return (
    <div className="rounded border bg-muted/40 p-2 text-xs">
      {preview.isLoading ? (
        <span className="flex items-center gap-1"><Loader2 className="size-3 animate-spin" /> 正在生成预览…</span>
      ) : preview.data ? (
        <div className="space-y-1">
          <p>合并后保留：<b>{preview.data.keep.name}</b>（状态 {preview.data.keep.status === 'APPROVED' ? '已通过' : preview.data.keep.status === 'REJECTED' ? '已拒绝' : '待审核'}）</p>
          {preview.data.mergedFields.map((f) => (
            <p key={f.field}>
              {f.field}（{f.strategy}）：{f.value}
            </p>
          ))}
        </div>
      ) : (
        <span>预览生成失败</span>
      )}
    </div>
  );
}

export function CharacterMergeCandidates({ bookId }: { bookId: string }) {
  const candidates = useCharacterMergeCandidates(bookId);
  const accept = useAcceptCharacterMerge(bookId);
  const reject = useRejectCharacterMerge(bookId);
  const judge = useJudgeCharacterMerges(bookId);

  if (!candidates.data?.candidates.length) return null;

  const suggestionBy = new Map(
    (candidates.data.suggestions ?? []).map((s) => [`${s.primaryId}:${s.secondaryId}`, s]),
  );

  return (
    <section className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-3">
      <div>
        <h3 className="font-medium">疑似重复角色（{candidates.data.candidates.length}）</h3>
        <p className="text-xs text-muted-foreground">
          模型只提供建议，不会自动合并或排除；请逐对人工确认。
        </p>
      </div>
      <Button
        size="sm"
        variant="outline"
        disabled={judge.isPending || accept.isPending || reject.isPending}
        onClick={() =>
          judge.mutate(undefined, {
            onSuccess: (outcome) => {
              if (outcome.message) toast.info(outcome.message);
              if (outcome.suggestedMerge.length || outcome.suggestedSeparate.length) {
                toast.success(
                  `模型建议合并 ${outcome.suggestedMerge.length} 对、保持独立 ${outcome.suggestedSeparate.length} 对，请人工确认；另有 ${outcome.pending.length} 对无法判断`
                );
              } else if (outcome.pending.length) {
                toast.info(`模型均无法确定，${outcome.pending.length} 对需人工判断`);
              }
            },
            onError: (error) =>
              toast.error(error instanceof Error ? error.message : '模型建议生成失败'),
          })
        }
      >
        {judge.isPending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
        生成模型建议
      </Button>

      {candidates.data.candidates.map((candidate) => (
        <div
          key={`${candidate.primaryId}-${candidate.secondaryId}`}
          className="space-y-1 rounded border bg-background p-2 text-sm"
        >
          <div>
            <b>{candidate.primary.name}</b> 与 <b>{candidate.secondary.name}</b>
            {' · '}
            {candidate.reasons.join('、')}
          </div>

          <SuggestionBadge suggestion={suggestionBy.get(`${candidate.primaryId}:${candidate.secondaryId}`)} />

          <p className="text-xs text-muted-foreground">
            别名：{candidate.primary.aliases.join('、') || '无'}
            {' / '}
            {candidate.secondary.aliases.join('、') || '无'}
          </p>

          <p className="text-xs text-muted-foreground">
            章节：{candidate.primary.chapterAppearances.join('、') || '未知'}
            {' / '}
            {candidate.secondary.chapterAppearances.join('、') || '未知'}
          </p>

          <p className="text-xs text-muted-foreground">
            {candidate.primary.description || '无描述'}
            {' / '}
            {candidate.secondary.description || '无描述'}
          </p>

          <MergePreviewPanel bookId={bookId} primaryId={candidate.primaryId} secondaryId={candidate.secondaryId} />

          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={accept.isPending || reject.isPending || judge.isPending}
              onClick={() =>
                accept.mutate(
                  { primaryId: candidate.primaryId, secondaryId: candidate.secondaryId },
                  {
                    onSuccess: () => toast.success(`已合并为「${candidate.primary.name}」`),
                    onError: (error) =>
                      toast.error(error instanceof Error ? error.message : '合并失败'),
                  },
                )
              }
            >
              合并为「{candidate.primary.name}」
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={accept.isPending || reject.isPending || judge.isPending}
              onClick={() =>
                reject.mutate(
                  { primaryId: candidate.primaryId, secondaryId: candidate.secondaryId },
                  {
                    onSuccess: () => toast.success('已保留为两个独立角色'),
                    onError: (error) =>
                      toast.error(error instanceof Error ? error.message : '操作失败'),
                  },
                )
              }
            >
              保持独立
            </Button>
          </div>
        </div>
      ))}
    </section>
  );
}
