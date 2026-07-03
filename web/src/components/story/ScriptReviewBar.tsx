import { CheckCircle2, XCircle } from 'lucide-react';
import type { ScriptReview } from '@/types/story';
import { cn } from '@/lib/utils';

/** 剧本审核结果条：accepted 绿条；否则红条列 blocker、黄字列 warning。 */
export function ScriptReviewBar({ review }: { review: ScriptReview }) {
  const blockers = review.issues.filter((i) => i.severity === 'blocker');
  const warnings = review.issues.filter((i) => i.severity === 'warning');

  return (
    <div
      className={cn(
        'rounded-md border px-3 py-2 text-sm',
        review.accepted
          ? 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-200'
          : 'border-destructive/40 bg-destructive/5 text-destructive',
      )}
    >
      <div className="flex items-center gap-2 font-medium">
        {review.accepted ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
        剧本审核{review.accepted ? '通过' : '未通过'}（第 {review.episodeNo} 集）
      </div>
      {blockers.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 text-xs">
          {blockers.map((i, idx) => (
            <li key={idx}>⛔ {i.message}</li>
          ))}
        </ul>
      )}
      {warnings.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 text-xs text-amber-700 dark:text-amber-400">
          {warnings.map((i, idx) => (
            <li key={idx}>⚠ {i.message}</li>
          ))}
        </ul>
      )}
      {review.notes.length > 0 && (
        <p className="mt-1.5 text-xs opacity-80">{review.notes.join('；')}</p>
      )}
    </div>
  );
}
