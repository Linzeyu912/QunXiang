import { useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { CheckCheck, Loader2, Search } from 'lucide-react';
import { useEntities, useUpdateEntity, useBatchUpdateStatus } from '@/api/entities';
import { matchArtifacts, useExtractionArtifacts } from '@/api/artifacts';
import { EntityListPanel } from '@/components/review/EntityListPanel';
import { EntityDetailPanel } from '@/components/review/EntityDetailPanel';
import { TierLegend } from '@/components/StatusBadge';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { parseAliases } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { AnyEntity, EntityStatus, EntityType, Tier } from '@/types';

const STATUS_OPTIONS: (EntityStatus | 'ALL')[] = ['ALL', 'PENDING', 'APPROVED', 'REJECTED'];
const TIER_OPTIONS: (Tier | 'ALL')[] = ['ALL', 'core', 'supporting', 'candidate', 'archived'];

const STATUS_LABEL: Record<EntityStatus | 'ALL', string> = {
  ALL: '全部状态',
  PENDING: '待审核',
  APPROVED: '已通过',
  REJECTED: '已拒绝',
};

const TIER_LABEL: Record<Tier | 'ALL', string> = {
  ALL: '全部层级',
  core: '核心',
  supporting: '支撑',
  candidate: '候选',
  archived: '归档',
};

const TITLE: Record<EntityType, string> = {
  character: '角色审核',
  location: '场景审核',
  item: '道具审核',
};

type SortKey = 'confidence' | 'mentions' | 'firstChapter' | 'name';

const SORT_LABEL: Record<SortKey, string> = {
  confidence: '按置信度',
  mentions: '按提及次数',
  firstChapter: '按首现章节',
  name: '按名称',
};

function sortEntities(list: AnyEntity[], sort: SortKey): AnyEntity[] {
  const sorted = [...list];
  switch (sort) {
    case 'confidence':
      sorted.sort((a, b) => b.confidence - a.confidence);
      break;
    case 'mentions':
      sorted.sort((a, b) => b.mentionCount - a.mentionCount);
      break;
    case 'firstChapter':
      sorted.sort((a, b) => (a.firstChapter ?? 1e9) - (b.firstChapter ?? 1e9));
      break;
    case 'name':
      sorted.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
      break;
  }
  return sorted;
}

interface Props {
  type: EntityType;
}

export function EntityReviewPage({ type }: Props) {
  const { bookId = '' } = useParams();
  const [sp, setSp] = useSearchParams();
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('confidence');

  const status = (sp.get('status') as EntityStatus | null) ?? undefined;
  const tier = (sp.get('tier') as Tier | null) ?? undefined;
  const selectedId = sp.get('sel') ?? undefined;

  const query = useEntities(type, bookId, { status, tier: type === 'character' ? undefined : tier });
  const update = useUpdateEntity(type, bookId);
  const artifactsQ = useExtractionArtifacts(bookId);

  const entities = useMemo(() => {
    let list = query.data ?? [];
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          parseAliases(e.aliases).some((a) => a.toLowerCase().includes(q)),
      );
    }
    return sortEntities(list, sort);
  }, [query.data, search, sort]);

  // 有视觉设定/提示词等富产物的实体，在列表里做标记
  const artifactNames = useMemo(() => {
    const set = new Set<string>();
    if (!artifactsQ.data?.available) return set;
    for (const e of query.data ?? []) {
      if (matchArtifacts(artifactsQ.data, type, e.name, parseAliases(e.aliases))) set.add(e.id);
    }
    return set;
  }, [artifactsQ.data, query.data, type]);

  const selected = useMemo(
    () => entities.find((e) => e.id === selectedId) ?? entities[0],
    [entities, selectedId],
  );

  const setStatus = (v: string) => {
    if (v === 'ALL') sp.delete('status');
    else sp.set('status', v);
    sp.delete('sel');
    setSp(sp, { replace: true });
  };

  const setTier = (v: string) => {
    if (v === 'ALL') sp.delete('tier');
    else sp.set('tier', v);
    sp.delete('sel');
    setSp(sp, { replace: true });
  };

  const handleSelect = (id: string) => {
    sp.set('sel', id);
    setSp(sp, { replace: true });
  };

  const moveSelection = (dir: 1 | -1) => {
    if (!selected || entities.length === 0) return;
    const idx = entities.findIndex((e) => e.id === selected.id);
    const nextIdx = Math.max(0, Math.min(entities.length - 1, idx + dir));
    const next = entities[nextIdx];
    if (next) handleSelect(next.id);
  };

  const reviewSelected = (nextStatus: 'APPROVED' | 'REJECTED') => {
    if (!selected || update.isPending) return;
    update.mutate(
      { id: selected.id, patch: { status: nextStatus } },
      {
        onSuccess: () => {
          toast.success(`${selected.name} ${nextStatus === 'APPROVED' ? '已通过' : '已拒绝'}`);
          moveSelection(1); // 审完自动跳下一个，配合 A/R 连续审核
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
      },
    );
  };

  useKeyboardShortcuts(
    {
      j: () => moveSelection(1),
      k: () => moveSelection(-1),
      arrowdown: () => moveSelection(1),
      arrowup: () => moveSelection(-1),
      a: () => reviewSelected('APPROVED'),
      r: () => reviewSelected('REJECTED'),
    },
    true,
  );

  const pendingInView = entities.filter((e) => e.status === 'PENDING');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{TITLE[type]}</h2>
          <p className="text-xs text-muted-foreground">
            {entities.length} 条 · J/K 移动 · A 通过 · R 拒绝
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索名称/别名"
              className="h-9 w-40 pl-7"
            />
          </div>
          <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(SORT_LABEL) as SortKey[]).map((s) => (
                <SelectItem key={s} value={s}>
                  {SORT_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={status ?? 'ALL'} onValueChange={setStatus}>
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((s) => (
                <SelectItem key={s} value={s}>
                  {STATUS_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {type !== 'character' && (
            <Select value={tier ?? 'ALL'} onValueChange={setTier}>
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIER_OPTIONS.map((t) => (
                  <SelectItem key={t} value={t}>
                    {TIER_LABEL[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <BatchApproveButton type={type} bookId={bookId} pending={pendingInView} />
        </div>
      </div>

      {type !== 'character' && (
        <TierLegend className="rounded-lg border bg-muted/30 px-3 py-2" />
      )}

      <div className="grid h-[calc(100vh-16rem)] grid-rows-1 grid-cols-[minmax(280px,2fr)_minmax(0,3fr)] overflow-hidden rounded-lg border bg-card">
        <div className="min-h-0 overflow-hidden border-r">
          {query.isLoading ? (
            <p className="p-6 text-sm text-muted-foreground">加载中…</p>
          ) : (
            <EntityListPanel
              entities={entities as AnyEntity[]}
              type={type}
              selectedId={selected?.id}
              onSelect={handleSelect}
              artifactIds={artifactNames}
            />
          )}
        </div>
        <div className="min-h-0 overflow-hidden">
          {selected ? (
            <EntityDetailPanel
              entity={selected}
              type={type}
              bookId={bookId}
              onJumpToName={(name) => {
                const target = (query.data ?? []).find(
                  (e) => e.name === name || parseAliases(e.aliases).includes(name),
                );
                if (target) handleSelect(target.id);
                else toast.info(`「${name}」不在当前列表（可能被筛选过滤或未入库）`);
              }}
            />
          ) : (
            <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
              选择一个实体查看详情
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** 批量通过当前筛选下的待审实体（一次 POST /batch，替代逐条 PATCH）。 */
function BatchApproveButton({
  type,
  bookId,
  pending,
}: {
  type: EntityType;
  bookId: string;
  pending: AnyEntity[];
}) {
  const batch = useBatchUpdateStatus(type, bookId);

  if (pending.length === 0) return null;

  const run = () => {
    batch.mutate(
      { ids: pending.map((e) => e.id), status: 'APPROVED' },
      {
        onSuccess: (res) => {
          if (res.updated.length > 0) toast.success(`已通过 ${res.updated.length} 条`);
          for (const s of res.skipped) toast.error(`跳过：${s.reason}`);
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
      },
    );
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={batch.isPending}>
          {batch.isPending ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <CheckCheck className="mr-1 h-4 w-4" />
          )}
          通过全部待审 ({pending.length})
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>批量通过 {pending.length} 条待审实体？</AlertDialogTitle>
          <AlertDialogDescription>
            将把当前筛选（含搜索）下所有「待审核」状态的实体标记为已通过。已通过/已拒绝的不受影响。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction onClick={run}>确认通过</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
