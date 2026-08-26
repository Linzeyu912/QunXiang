import { Button } from '@/components/ui/button';
import { useAcceptCharacterMerge, useCharacterMergeCandidates, useJudgeCharacterMerges, useRejectCharacterMerge } from '@/api/entities';
import { toast } from 'sonner';
import { Loader2, Sparkles } from 'lucide-react';

export function CharacterMergeCandidates({ bookId }: { bookId: string }) {
  const candidates = useCharacterMergeCandidates(bookId);
  const accept = useAcceptCharacterMerge(bookId);
  const reject = useRejectCharacterMerge(bookId);
  const judge = useJudgeCharacterMerges(bookId);

  if (!candidates.data?.length) return null;

  return (
    <section className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-3">
      <div>
        <h3 className="font-medium">疑似重复角色（{candidates.data.length}）</h3>
        <p className="text-xs text-muted-foreground">
          称谓和别名不会自动合并，请根据章节与描述确认。
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
              if (outcome.merged.length || outcome.separated.length) {
                toast.success(
                  `自动合并 ${outcome.merged.length} 对，自动排除 ${outcome.separated.length} 对，剩余 ${outcome.pending.length} 对需人工确认`
                );
              }
            },
            onError: (error) =>
              toast.error(error instanceof Error ? error.message : '智能裁决失败'),
          })
        }
      >
        {judge.isPending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
        模型智能裁决
      </Button>

      {candidates.data.map((candidate) => (
        <div
          key={`${candidate.primaryId}-${candidate.secondaryId}`}
          className="space-y-1 rounded border bg-background p-2 text-sm"
        >
          <div>
            <b>{candidate.primary.name}</b> 与 <b>{candidate.secondary.name}</b>
            {' · '}
            {candidate.reasons.join('、')}
          </div>

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
