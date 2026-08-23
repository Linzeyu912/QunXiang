import { Button } from '@/components/ui/button';
import { useAcceptCharacterMerge, useCharacterMergeCandidates, useRejectCharacterMerge } from '@/api/entities';
import { toast } from 'sonner';

export function CharacterMergeCandidates({ bookId }: { bookId: string }) {
  const candidates = useCharacterMergeCandidates(bookId);
  const accept = useAcceptCharacterMerge(bookId);
  const reject = useRejectCharacterMerge(bookId);

  if (!candidates.data?.length) return null;

  return (
    <section className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-3">
      <div>
        <h3 className="font-medium">疑似重复角色（{candidates.data.length}）</h3>
        <p className="text-xs text-muted-foreground">
          称谓和别名不会自动合并，请根据章节与描述确认。
        </p>
      </div>

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
              disabled={accept.isPending || reject.isPending}
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
              disabled={accept.isPending || reject.isPending}
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
