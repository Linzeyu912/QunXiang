import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EntityStatusBadge, TierBadge } from '@/components/StatusBadge';
import { parseAliases } from '@/lib/utils';
import type { AnyEntity, EntityType } from '@/types';

interface Props {
  entities: AnyEntity[];
  type: EntityType;
  selectedId?: string;
  onSelect: (id: string) => void;
  /** 拥有提取富产物（视觉设定/提示词）的实体 id 集合，列表中加星标 */
  artifactIds?: Set<string>;
}

export function EntityListPanel({ entities, type, selectedId, onSelect, artifactIds }: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: entities.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 68,
    overscan: 8,
  });

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
          const aliases = parseAliases(entity.aliases);
          const isSelected = entity.id === selectedId;
          const hasTier = type !== 'character' && 'tier' in entity;
          return (
            <button
              key={entity.id}
              onClick={() => onSelect(entity.id)}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                transform: `translateY(${v.start}px)`,
              }}
              className={cn(
                'w-full border-b px-4 py-3 text-left transition-colors hover:bg-accent/50',
                isSelected && 'bg-accent',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1 truncate text-sm font-medium">
                  {entity.name}
                  {artifactIds?.has(entity.id) && (
                    <Sparkles
                      className="h-3 w-3 shrink-0 text-amber-500"
                      aria-label="含视觉设定与提示词"
                    />
                  )}
                </span>
                <div className="flex shrink-0 items-center gap-1">
                  {hasTier && <TierBadge tier={(entity as { tier: 'core' | 'supporting' | 'candidate' | 'archived' }).tier} />}
                  <EntityStatusBadge status={entity.status} />
                </div>
              </div>
              <p className="mt-1 truncate text-xs text-muted-foreground">
                {aliases.length > 0 ? `别名: ${aliases.join('/')}` : '无别名'} · 置信度{' '}
                {(entity.confidence * 100).toFixed(0)}%
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
