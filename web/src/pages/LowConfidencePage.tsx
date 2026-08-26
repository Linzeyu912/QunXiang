import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Check, Loader2, Trash2, Archive } from 'lucide-react';
import { useEntities, useUpdateEntity } from '@/api/entities';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { ListItemSkeleton } from '@/components/ui/skeleton';
import type { AnyEntity, EntityType } from '@/types';

/** 低置信度库：置信度低于阈值的待审核实体只保留名字在此，防止遗漏；
 *  不参与补写管线。确认为真实实体可「转为正式」，误提取可「移除」。 */

const KIND_LABEL: Record<Exclude<EntityType, 'worldview'>, string> = {
  character: '角色',
  location: '场景',
  item: '道具',
};

function LowConfidenceGroup({
  type,
  bookId,
  entities,
  loading,
}: {
  type: Exclude<EntityType, 'worldview'>;
  bookId: string;
  entities: AnyEntity[];
  loading: boolean;
}) {
  const update = useUpdateEntity(type, bookId);
  // 正在处理中的实体 id（防止重复点击）
  const [busyId, setBusyId] = useState<string | null>(null);

  const decide = async (entity: AnyEntity, status: 'APPROVED' | 'REJECTED') => {
    setBusyId(entity.id);
    try {
      await update.mutateAsync({ id: entity.id, patch: { status } });
      toast.success(status === 'APPROVED' ? `「${entity.name}」已转为正式实体` : `「${entity.name}」已移除`);
    } catch (e) {
      toast.error(`操作失败：${(e as Error).message}`);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-sm font-semibold">{KIND_LABEL[type]}</h3>
        <Badge variant="secondary">{entities.length}</Badge>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <ListItemSkeleton key={i} />
          ))}
        </div>
      ) : entities.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">暂无低置信度{KIND_LABEL[type]}</p>
      ) : (
        <ul className="divide-y">
          {entities.map((entity) => {
            const busy = busyId === entity.id || update.isPending;
            return (
              <li key={entity.id} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-medium">{entity.name}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    置信度 {(entity.confidence * 100).toFixed(0)}%
                    {entity.firstChapter != null && ` · 首现第 ${entity.firstChapter} 章`}
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1 px-2 text-xs"
                  disabled={busy}
                  onClick={() => decide(entity, 'APPROVED')}
                  title="确认是真实实体，转入主审核列表"
                >
                  {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                  转为正式
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-destructive"
                  disabled={busy}
                  onClick={() => decide(entity, 'REJECTED')}
                  title="确认是误提取，从低置信度库移除"
                >
                  <Trash2 className="h-3 w-3" />
                  移除
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

export function LowConfidencePage() {
  const { bookId = '' } = useParams();
  const charactersQ = useEntities('character', bookId, { confidence: 'low' });
  const locationsQ = useEntities('location', bookId, { confidence: 'low' });
  const itemsQ = useEntities('item', bookId, { confidence: 'low' });

  const total =
    (charactersQ.data?.length ?? 0) + (locationsQ.data?.length ?? 0) + (itemsQ.data?.length ?? 0);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Archive className="h-5 w-5 text-muted-foreground" />
          低置信度库
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          置信度较低的实体暂存于此防止遗漏，只保留名字、不参与描述补写与提示词生成。
          确认无误可「转为正式」进入主审核列表，误提取可直接「移除」。
        </p>
      </div>

      {!charactersQ.isLoading && !locationsQ.isLoading && !itemsQ.isLoading && total === 0 && (
        <Card className="p-10 text-center text-sm text-muted-foreground">
          当前没有低置信度实体
        </Card>
      )}

      <LowConfidenceGroup
        type="character"
        bookId={bookId}
        entities={charactersQ.data ?? []}
        loading={charactersQ.isLoading}
      />
      <LowConfidenceGroup
        type="location"
        bookId={bookId}
        entities={locationsQ.data ?? []}
        loading={locationsQ.isLoading}
      />
      <LowConfidenceGroup
        type="item"
        bookId={bookId}
        entities={itemsQ.data ?? []}
        loading={itemsQ.isLoading}
      />
    </div>
  );
}
