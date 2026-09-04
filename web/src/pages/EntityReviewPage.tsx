import { useCallback, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { CheckCheck, Loader2, Search } from 'lucide-react';
import { useEntities, useUpdateEntity, useBatchUpdateStatus } from '@/api/entities';
import { matchArtifacts, useExtractionArtifacts } from '@/api/artifacts';
import { EntityListPanel } from '@/components/review/EntityListPanel';
import { EntityDetailPanel } from '@/components/review/EntityDetailPanel';
import { CharacterMergeCandidates } from '@/components/review/CharacterMergeCandidates';
import { WorldviewSynthesisPanel } from '@/components/review/WorldviewSynthesisPanel';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { parseAliases } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
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
import type { AnyEntity, EntityStatus, EntityType } from '@/types';

const STATUS_OPTIONS: (EntityStatus | 'ALL')[] = ['ALL', 'PENDING', 'APPROVED', 'REJECTED'];

const STATUS_LABEL: Record<EntityStatus | 'ALL', string> = {
  ALL: '全部状态',
  PENDING: '待审核',
  APPROVED: '已通过',
  REJECTED: '已拒绝',
};

// 道具大类筛选项（仅道具 Tab 展示）
const ITEM_CATEGORY_OPTIONS = ['ALL', 'weapon', 'skill', 'food', 'pill', 'treasure', 'electronics', 'document', 'other'] as const;

const ITEM_CATEGORY_LABEL: Record<(typeof ITEM_CATEGORY_OPTIONS)[number], string> = {
  ALL: '全部大类',
  weapon: '武器',
  skill: '技能功法',
  food: '食物',
  pill: '丹药消耗品',
  treasure: '法宝器物',
  electronics: '电子设备',
  document: '文件信物',
  other: '其他物品',
};

const TITLE: Record<EntityType, string> = {
  character: '角色审核',
  location: '场景审核',
  item: '道具审核',
  worldview: '世界观与体系审核',
};

// 默认按提及次数排序：置信度衡量“抽取结果是否可信”，
// 由模型判断与提及次数、覆盖章节、角色对话次数共同校准；
// 它不等于叙事重要性，因此列表优先使用提及次数。
type SortKey = 'mentions' | 'confidence' | 'firstChapter' | 'name';

const SORT_LABEL: Record<SortKey, string> = {
  mentions: '按提及次数',
  confidence: '按置信度',
  firstChapter: '按首现章节',
  name: '按名称',
};

function sortEntities(list: AnyEntity[], sort: SortKey): AnyEntity[] {
  const sorted = [...list];
  switch (sort) {
    case 'mentions':
      sorted.sort((a, b) => b.mentionCount - a.mentionCount || b.confidence - a.confidence);
      break;
    case 'confidence':
      sorted.sort((a, b) => b.confidence - a.confidence || b.mentionCount - a.mentionCount);
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
  const [sort, setSort] = useState<SortKey>('mentions');

  const status = (sp.get('status') as EntityStatus | null) ?? undefined;
  const category = sp.get('category') ?? undefined;
  const selectedId = sp.get('sel') ?? undefined;

  // 缺省集合 MAIN 会排除已拒绝实体，审核页显式用 ALL：「全部状态」才包含已拒绝，
  // 且与 待审核/已通过/已拒绝 三个单项筛选构成完整并集（低置信度待审仍由低置信度库承接）。
  const query = useEntities(type, bookId, {
    status,
    reviewBucket: 'ALL',
    category: type === 'item' ? category : undefined,
  });
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

  // URL 参数统一走函数式更新：不就地改 sp 对象，且保证回调引用稳定
  //（配合 memo 化的列表/详情面板，工具栏输入不会触发整棵子树重渲染）。
  const setStatus = useCallback(
    (v: string) => {
      setSp(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (v === 'ALL') next.delete('status');
          else next.set('status', v);
          next.delete('sel');
          return next;
        },
        { replace: true },
      );
    },
    [setSp],
  );

  const setCategory = useCallback(
    (v: string) => {
      setSp(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (v === 'ALL') next.delete('category');
          else next.set('category', v);
          next.delete('sel');
          return next;
        },
        { replace: true },
      );
    },
    [setSp],
  );

  const handleSelect = useCallback(
    (id: string) => {
      setSp(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('sel', id);
          return next;
        },
        { replace: true },
      );
    },
    [setSp],
  );

  const handleJumpToName = useCallback(
    (name: string) => {
      const target = (query.data ?? []).find(
        (e) => e.name === name || parseAliases(e.aliases).includes(name),
      );
      if (target) handleSelect(target.id);
      else toast.info(`「${name}」不在当前列表（可能被筛选过滤或未入库）`);
    },
    [query.data, handleSelect],
  );

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

  const pendingInView = useMemo(() => entities.filter((e) => e.status === 'PENDING'), [entities]);

  return (
    <div className="space-y-4">
      {type === 'character' && <CharacterMergeCandidates bookId={bookId} />}
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
              aria-label="搜索名称或别名"
              className="h-9 w-40 pl-7"
            />
          </div>
          <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
            <SelectTrigger className="w-32" aria-label="排序方式">
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
            <SelectTrigger className="w-28" aria-label="状态筛选">
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
          {type === 'item' && (
            <Select value={category ?? 'ALL'} onValueChange={setCategory}>
              <SelectTrigger className="w-32" aria-label="道具大类筛选">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ITEM_CATEGORY_OPTIONS.map((c) => (
                  <SelectItem key={c} value={c}>
                    {ITEM_CATEGORY_LABEL[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <BatchApproveButton type={type} bookId={bookId} pending={pendingInView} />
        </div>
      </div>

      {type === 'worldview' ? (
        <WorldviewSynthesisPanel bookId={bookId} />
      ) : (
        <div className="grid h-[calc(100vh-16rem)] grid-cols-1 grid-rows-[1fr_1fr] overflow-hidden rounded-lg border bg-card shadow-sm md:grid-cols-[minmax(280px,2fr)_minmax(0,3fr)] md:grid-rows-1">
          <div className="relative min-h-0 overflow-hidden border-r">
            {query.isLoading ? (
              <EntityListSkeleton />
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
                onJumpToName={handleJumpToName}
              />
            ) : (
              <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
                选择一个实体查看详情
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** 实体列表加载骨架：按真实行高（约 68px）铺占位行，加载完成后不跳版。 */
function EntityListSkeleton() {
  return (
    <div className="absolute inset-0 overflow-hidden" aria-label="实体列表加载中">
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
        <div key={i} className="border-b border-border/60 px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-5 w-12" />
          </div>
          <Skeleton className="mt-2 h-3 w-40" />
        </div>
      ))}
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
