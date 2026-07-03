import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Check, Loader2, Pencil, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { EntityStatusBadge, TierBadge } from '@/components/StatusBadge';
import { ConfidenceBar } from './ConfidenceBar';
import { EntityArtifactsSection } from './EntityArtifactsSection';
import { formatDate, parseAliases } from '@/lib/utils';
import { useCharacterReviews, useUpdateEntity } from '@/api/entities';
import { matchArtifacts, useExtractionArtifacts } from '@/api/artifacts';
import type { AnyEntity, Character, CharacterReview, EntityStatus, EntityType } from '@/types';

interface Props {
  entity: AnyEntity;
  type: EntityType;
  bookId: string;
  /** 点击共现角色时跳转到该角色（由列表页实现按名查找） */
  onJumpToName?: (name: string) => void;
}

export function EntityDetailPanel({ entity, type, bookId, onJumpToName }: Props) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(entity.name);
  const [aliasesText, setAliasesText] = useState(parseAliases(entity.aliases).join('，'));
  const [description, setDescription] = useState(entity.description ?? '');

  const update = useUpdateEntity(type, bookId);
  const artifactsQ = useExtractionArtifacts(bookId);
  const artifacts = matchArtifacts(artifactsQ.data, type, entity.name, parseAliases(entity.aliases));

  useEffect(() => {
    setName(entity.name);
    setAliasesText(parseAliases(entity.aliases).join('，'));
    setDescription(entity.description ?? '');
    setEditing(false);
  }, [entity.id, entity.aliases, entity.description, entity.name]);

  const setStatus = async (status: EntityStatus) => {
    try {
      await update.mutateAsync({ id: entity.id, patch: { status } });
      toast.success(status === 'APPROVED' ? '已通过' : '已拒绝');
    } catch (e) {
      toast.error(`更新失败：${(e as Error).message}`);
    }
  };

  const saveEdits = async () => {
    try {
      const aliases = aliasesText
        .split(/[，,、\n]/)
        .map((s) => s.trim())
        .filter(Boolean);
      await update.mutateAsync({
        id: entity.id,
        patch: { name: name.trim(), aliases, description: description.trim() },
      });
      toast.success('已保存修改');
      setEditing(false);
    } catch (e) {
      toast.error(`保存失败：${(e as Error).message}`);
    }
  };

  const aliases = parseAliases(entity.aliases);
  const hasTier = type !== 'character' && 'tier' in entity;
  const importance = 'importanceScore' in entity ? entity.importanceScore : undefined;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-3 border-b p-4">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-lg font-semibold">{entity.name}</h2>
            <EntityStatusBadge status={entity.status} />
            {hasTier && (
              <TierBadge
                tier={(entity as { tier: 'core' | 'supporting' | 'candidate' | 'archived' }).tier}
              />
            )}
          </div>
          <p className="text-xs text-muted-foreground">ID {entity.id.slice(0, 8)}</p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setStatus('APPROVED')}
            disabled={update.isPending || entity.status === 'APPROVED'}
            className="gap-1"
          >
            <Check className="h-3.5 w-3.5" />
            通过
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setStatus('REJECTED')}
            disabled={update.isPending || entity.status === 'REJECTED'}
            className="gap-1"
          >
            <X className="h-3.5 w-3.5" />
            拒绝
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        <div className="space-y-6">
          <ConfidenceBar value={entity.confidence} />

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-medium">基本信息</h3>
              {editing ? (
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                    取消
                  </Button>
                  <Button size="sm" onClick={saveEdits} disabled={update.isPending}>
                    {update.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : '保存'}
                  </Button>
                </div>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => setEditing(true)} className="gap-1">
                  <Pencil className="h-3.5 w-3.5" />
                  编辑
                </Button>
              )}
            </div>
            {editing ? (
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label>名称</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>别名（逗号分隔）</Label>
                  <Input value={aliasesText} onChange={(e) => setAliasesText(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>描述</Label>
                  <Textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={4}
                  />
                </div>
              </div>
            ) : (
              <dl className="space-y-2 text-sm">
                <Row label="别名">
                  {aliases.length ? (
                    <div className="flex flex-wrap gap-1">
                      {aliases.map((a) => (
                        <Badge key={a} variant="secondary">
                          {a}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <span className="text-muted-foreground">无</span>
                  )}
                </Row>
                <Row label="描述">
                  <span className="whitespace-pre-wrap text-foreground">
                    {entity.description ?? <span className="text-muted-foreground">无</span>}
                  </span>
                </Row>
              </dl>
            )}
          </div>

          <Separator />

          <div>
            <h3 className="mb-2 text-sm font-medium">出现统计</h3>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <Row label="提及次数">{entity.mentionCount}</Row>
              <Row label="首末章节">
                {entity.firstChapter ?? '?'} - {entity.lastChapter ?? '?'}
              </Row>
              {type === 'character' && 'dialogueCount' in entity && (
                <Row label="对话次数">{entity.dialogueCount}</Row>
              )}
              {importance !== undefined && <Row label="重要性">{importance.toFixed(3)}</Row>}
            </dl>
          </div>

          {hasTier && (
            <>
              <Separator />
              <div>
                <h3 className="mb-2 text-sm font-medium">三支柱评分</h3>
                <dl className="grid grid-cols-3 gap-2 text-sm">
                  <Row label="因果">
                    {(entity as { pillarCausal: number }).pillarCausal}
                  </Row>
                  <Row label="唯一">
                    {(entity as { pillarUniqueness: number }).pillarUniqueness}
                  </Row>
                  <Row label="转折">
                    {(entity as { pillarTransition: number }).pillarTransition}
                  </Row>
                </dl>
              </div>
            </>
          )}

          {type === 'character' && (
            <CoCharactersSection
              entity={entity as Character}
              onJumpToName={onJumpToName}
            />
          )}

          <EntityArtifactsSection artifacts={artifacts} />

          {type === 'character' && <ReviewHistorySection characterId={entity.id} />}
        </div>
      </div>
    </div>
  );
}

/** 共现角色（Character.coCharacters，提取阶段统计的同场景/同段落共现） */
function CoCharactersSection({
  entity,
  onJumpToName,
}: {
  entity: Character;
  onJumpToName?: (name: string) => void;
}) {
  const coCharacters = parseAliases(entity.coCharacters);
  if (coCharacters.length === 0) return null;
  return (
    <>
      <Separator />
      <div>
        <h3 className="mb-2 text-sm font-medium">共现角色</h3>
        <div className="flex flex-wrap gap-1">
          {coCharacters.map((name) => (
            <Badge
              key={name}
              variant="outline"
              className={onJumpToName ? 'cursor-pointer hover:bg-accent' : undefined}
              onClick={() => onJumpToName?.(name)}
            >
              {name}
            </Badge>
          ))}
        </div>
      </div>
    </>
  );
}

const REVIEW_ACTION_LABEL: Record<CharacterReview['action'], string> = {
  APPROVED: '通过',
  REJECTED: '拒绝',
  EDITED: '编辑',
};

/** 审核历史（CharacterReview 表，记录每次通过/拒绝/编辑） */
function ReviewHistorySection({ characterId }: { characterId: string }) {
  const reviewsQ = useCharacterReviews(characterId);
  const reviews = reviewsQ.data ?? [];
  if (reviews.length === 0) return null;
  return (
    <>
      <Separator />
      <div>
        <h3 className="mb-2 text-sm font-medium">审核历史</h3>
        <ul className="space-y-1.5">
          {reviews.map((r) => (
            <li key={r.id} className="flex items-center gap-2 text-xs">
              <Badge
                variant={
                  r.action === 'APPROVED' ? 'success' : r.action === 'REJECTED' ? 'destructive' : 'info'
                }
              >
                {REVIEW_ACTION_LABEL[r.action] ?? r.action}
              </Badge>
              <span className="text-muted-foreground">{formatDate(r.createdAt)}</span>
              {r.action === 'EDITED' && r.previousValue && r.newValue && (
                <span className="truncate text-muted-foreground">
                  {r.previousValue} → {r.newValue}
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
