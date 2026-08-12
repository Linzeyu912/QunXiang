import { memo, useEffect, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EntityStatusBadge, TierBadge } from '@/components/StatusBadge';
import { Badge } from '@/components/ui/badge';
import { parseAliases } from '@/lib/utils';
import { ITEM_CATEGORY_LABEL } from '@/types';
import type { AnyEntity, EntityType, ItemCategory } from '@/types';

interface Props {
  entities: AnyEntity[];
  type: EntityType;
  selectedId?: string;
  onSelect: (id: string) => void;
  /** 拥有提取富产物（视觉设定/提示词）的实体 id 集合，列表中加星标 */
  artifactIds?: Set<string>;
}

interface RowProps {
  entity: AnyEntity;
  type: EntityType;
  isSelected: boolean;
  hasArtifact: boolean;
  onSelect: (id: string) => void;
  /** 虚拟列表给出的行偏移（px） */
  start: number;
}

/**
 * 单行抽成 memo 组件：选中项变化时只有新旧两行重渲染，
 * 别名解析（parseAliases）也只发生在真正渲染的行上。
 */
const EntityRow = memo(function EntityRow({
  entity,
  type,
  isSelected,
  hasArtifact,
  onSelect,
  start,
}: RowProps) {
  const aliases = parseAliases(entity.aliases);
  const hasTier = type !== 'character' && 'tier' in entity;
  const itemCategory = type === 'item' ? (entity as { category?: ItemCategory }).category : undefined;
  return (
    <button
      onClick={() => onSelect(entity.id)}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        transform: `translateY(${start}px)`,
      }}
      className={cn(
        'w-full border-b border-border/60 px-4 py-3 text-left transition-colors hover:bg-accent/60',
        // 选中行用左侧主色指示条 + 浅底，扫长列表时视线定位更快
        isSelected && 'bg-accent shadow-[inset_2px_0_0_0_hsl(var(--primary))]',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1 truncate text-sm font-medium">
          {entity.name}
          {hasArtifact && (
            <Sparkles
              className="h-3 w-3 shrink-0 text-amber-500"
              aria-label="含视觉设定与提示词"
            />
          )}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          {itemCategory && (
            <Badge variant="outline" className="px-1 text-[10px] font-normal">
              {ITEM_CATEGORY_LABEL[itemCategory] ?? itemCategory}
            </Badge>
          )}
          {hasTier && (
            <TierBadge
              tier={(entity as { tier: 'core' | 'supporting' | 'candidate' | 'archived' }).tier}
            />
          )}
          <EntityStatusBadge status={entity.status} />
        </div>
      </div>
      <p className="mt-1 truncate text-xs text-muted-foreground">
        {aliases.length > 0 ? `别名: ${aliases.join('/')}` : '无别名'} · 置信度{' '}
        {(entity.confidence * 100).toFixed(0)}%
      </p>
    </button>
  );
});

function EntityListPanelInner({ entities, type, selectedId, onSelect, artifactIds }: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: entities.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 68,
    overscan: 8,
  });

  // 选中项滚动跟随：J/K 快捷键移动或 A/R 审完自动跳下一个时，
  // 若新选中行在可视区外则滚到可见位置（align: 'auto' 表示已在可视区内不动）。
  // 也覆盖通过 URL ?sel= 直达页面的初次定位场景。
  const selectedIndex = useMemo(
    () => entities.findIndex((e) => e.id === selectedId),
    [entities, selectedId],
  );
  useEffect(() => {
    if (selectedIndex >= 0) {
      virtualizer.scrollToIndex(selectedIndex, { align: 'auto' });
    }
  }, [selectedIndex, virtualizer]);

  if (entities.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <p className="text-sm text-muted-foreground">当前筛选下没有实体</p>
      </div>
    );
  }

  // 滚动容器用 absolute inset-0 填满父级（父级 EntityReviewPage 已加 relative）。
  // 这是 @tanstack/react-virtual 官方推荐的稳健写法：保证 virtualizer 读到的
  // clientHeight 永远等于父格高度，不因 grid/flex 子项 min-height 撑开或窗口
  // 缩放而塌陷为 0（塌陷时只会渲染首屏可见项，表现为"只看得到最上面"）。
  return (
    <div ref={parentRef} className="absolute inset-0 overflow-auto">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((v) => {
          const entity = entities[v.index];
          return (
            <EntityRow
              key={entity.id}
              entity={entity}
              type={type}
              isSelected={entity.id === selectedId}
              hasArtifact={artifactIds?.has(entity.id) ?? false}
              onSelect={onSelect}
              start={v.start}
            />
          );
        })}
      </div>
    </div>
  );
}

// memo 包裹整个面板：工具栏输入搜索词等父级重渲染时，
// 只要列表数据/选中项没变就不重跑虚拟列表。
export const EntityListPanel = memo(EntityListPanelInner);
