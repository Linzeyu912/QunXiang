import { Badge } from './ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { cn } from '@/lib/utils';
import type { BookStatus, EntityStatus, StageStatus, Tier } from '@/types';

const BOOK: Record<BookStatus, { label: string; variant: 'info' | 'warning' | 'success' | 'destructive' }> = {
  UPLOADED: { label: '待提取', variant: 'info' },
  EXTRACTING: { label: '提取中', variant: 'warning' },
  EXTRACTED: { label: '已提取', variant: 'success' },
  FAILED: { label: '失败', variant: 'destructive' },
};

const ENTITY: Record<EntityStatus, { label: string; variant: 'muted' | 'success' | 'destructive' }> = {
  PENDING: { label: '待审核', variant: 'muted' },
  APPROVED: { label: '已通过', variant: 'success' },
  REJECTED: { label: '已拒绝', variant: 'destructive' },
};

const STAGE: Record<StageStatus, { label: string; variant: 'muted' | 'info' | 'success' | 'destructive' }> = {
  pending: { label: '待运行', variant: 'muted' },
  running: { label: '进行中', variant: 'info' },
  completed: { label: '完成', variant: 'success' },
  failed: { label: '失败', variant: 'destructive' },
};

const TIER: Record<Tier, { label: string; short: string; hint: string; className: string }> = {
  core: {
    label: '核心',
    short: '不可或缺',
    hint: '叙事分 ≥5：强驱动剧情、不可替代的核心实体',
    className: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  },
  supporting: {
    label: '支撑',
    short: '反复出场',
    hint: '叙事分 3–4：多次出现、对剧情有实际作用的配角级实体',
    className: 'bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300',
  },
  candidate: {
    label: '候选',
    short: '边缘',
    hint: '叙事分 1–2：重要性低，可能仅一次性提及',
    className: 'bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300',
  },
  archived: {
    label: '归档',
    short: '可忽略',
    hint: '叙事分 0：基本可忽略，多为误提或纯提及',
    className: 'bg-neutral-100 text-neutral-500 dark:bg-neutral-500/15 dark:text-neutral-400',
  },
};

export function BookStatusBadge({ status }: { status: BookStatus }) {
  const c = BOOK[status] ?? { label: status, variant: 'muted' as const };
  return <Badge variant={c.variant}>{c.label}</Badge>;
}

export function EntityStatusBadge({ status }: { status: EntityStatus }) {
  const c = ENTITY[status] ?? { label: status, variant: 'muted' as const };
  return <Badge variant={c.variant}>{c.label}</Badge>;
}

export function StageStatusBadge({ status }: { status: StageStatus }) {
  const c = STAGE[status] ?? { label: status, variant: 'muted' as const };
  return <Badge variant={c.variant}>{c.label}</Badge>;
}

// 与 Badge 同款底样式；用 span 而非 div，便于放进 <button>（列表行）且作为 Tooltip 触发器。
const TIER_BADGE_BASE =
  'inline-flex items-center rounded-md border border-transparent px-2 py-0.5 text-xs font-medium transition-colors';

export function TierBadge({ tier }: { tier: Tier }) {
  const c = TIER[tier];
  if (!c) return <Badge variant="muted">{tier}</Badge>;
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={cn(TIER_BADGE_BASE, c.className)}>{c.label}</span>
        </TooltipTrigger>
        <TooltipContent className="max-w-[16rem]">
          <p className="font-medium">
            {c.label}层 · {c.short}
          </p>
          <p className="mt-0.5">{c.hint}</p>
          <p className="mt-1 text-[10px] opacity-70">由预扫描叙事三支柱自动评分，仅供参考</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * 场景/道具审核页的分层图例：把四档含义直接铺在页面顶部，
 * 避免用户看到“核心/支撑/候选/归档”badge 却不知道各自代表什么。
 */
export function TierLegend({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground',
        className,
      )}
    >
      <span className="font-medium text-foreground">分层图例</span>
      {(Object.keys(TIER) as Tier[]).map((t) => (
        <span key={t} className="inline-flex items-center gap-1">
          <span className={cn(TIER_BADGE_BASE, TIER[t].className)}>{TIER[t].label}</span>
          <span>{TIER[t].short}</span>
        </span>
      ))}
      <span className="text-[11px]">· 按因果 / 唯一 / 转折三支柱自动评分，可人工复核</span>
    </div>
  );
}
