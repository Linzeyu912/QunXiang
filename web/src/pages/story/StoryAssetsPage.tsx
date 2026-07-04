import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, Boxes, Download, Loader2 } from 'lucide-react';
import {
  useAssetPack,
  useAssetPrompts,
  useExtractAssets,
  usePatchAsset,
  useStoryDetail,
} from '@/api/stories';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ConfidenceBar } from '@/components/review/ConfidenceBar';
import { AssetWarningBanner } from '@/components/story/AssetWarningBanner';
import { EditableTextBlock } from '@/components/story/EditableTextBlock';
import { EvidenceSnippets } from '@/components/story/EvidenceSnippets';
import { PromptCopyBlock, downloadJson } from '@/components/story/PromptCopyBlock';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { cn } from '@/lib/utils';
import type {
  CharacterInStory,
  PropInStory,
  SceneInStory,
  StoryAssetType,
} from '@/types/story';

type AnyAsset = CharacterInStory | SceneInStory | PropInStory;

const ROLE_LABEL: Record<string, string> = {
  protagonist: '主角',
  antagonist: '反派',
  supporting: '配角',
  minor: '次要',
};

const PROP_TYPE_LABEL: Record<string, string> = {
  weapon: '武器',
  document: '文书',
  token: '信物',
  tool: '工具',
  money: '钱财',
  other: '其他',
};

const DESCRIPTION_QUALITY_LABEL: Record<string, string> = {
  sufficient: '充分',
  thin: '稀薄',
  missing: '缺失',
};

export function StoryAssetsPage() {
  const { bookId = '', storyId = '' } = useParams();
  const storyQ = useStoryDetail(bookId, storyId);
  const packQ = useAssetPack(bookId, storyId);
  const extractM = useExtractAssets(bookId);

  const story = storyQ.data;
  const pack = packQ.data;
  const notExtracted = packQ.isError;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" asChild>
            <Link to={`/books/${bookId}/stories?sel=${storyId}`} aria-label="返回故事列表">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h2 className="text-lg font-semibold">故事资产</h2>
            <p className="text-xs text-muted-foreground">
              {story ? `${story.title} · 第 ${story.startChapter}-${story.endChapter} 章` : '加载中…'}
            </p>
          </div>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              disabled={extractM.isPending || !story?.approved}
              title={story?.approved ? undefined : '故事段未审批'}
            >
              {extractM.isPending ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Boxes className="mr-1.5 h-4 w-4" />
              )}
              重新提取资产
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>重新提取资产？</AlertDialogTitle>
              <AlertDialogDescription>
                将按当前故事段重新生成全部角色、场景、道具与视觉提示词，包括你手动修改过的描述也会被覆盖。此操作不可撤销。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction
                onClick={() =>
                  extractM.mutate(storyId, {
                    onSuccess: () => toast.success('资产已重新提取'),
                    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
                  })
                }
              >
                确认重新提取
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {packQ.isLoading ? (
        <p className="p-6 text-sm text-muted-foreground">加载中…</p>
      ) : notExtracted ? (
        <div className="flex h-[40vh] flex-col items-center justify-center gap-3 rounded-lg border border-dashed">
          <Boxes className="h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">该故事段还没有提取过资产。</p>
          <Button
            disabled={extractM.isPending || !story?.approved}
            title={story?.approved ? undefined : '先在故事页审批本段'}
            onClick={() =>
              extractM.mutate(storyId, {
                onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
              })
            }
          >
            {extractM.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            提取本故事资产
          </Button>
          {!story?.approved && (
            <p className="text-xs text-muted-foreground">故事段未审批，无法提取。</p>
          )}
        </div>
      ) : (
        pack && (
          <>
            <AssetWarningBanner warnings={pack.assetWarnings} />
            <Tabs defaultValue="characters">
              <TabsList>
                <TabsTrigger value="characters">角色 {pack.characters.length}</TabsTrigger>
                <TabsTrigger value="scenes">场景 {pack.scenes.length}</TabsTrigger>
                <TabsTrigger value="props">道具 {pack.props.length}</TabsTrigger>
                <TabsTrigger value="prompts">提示词</TabsTrigger>
              </TabsList>
              <TabsContent value="characters">
                <AssetPane bookId={bookId} storyId={storyId} type="character" assets={pack.characters} />
              </TabsContent>
              <TabsContent value="scenes">
                <AssetPane bookId={bookId} storyId={storyId} type="scene" assets={pack.scenes} />
              </TabsContent>
              <TabsContent value="props">
                <AssetPane bookId={bookId} storyId={storyId} type="prop" assets={pack.props} />
              </TabsContent>
              <TabsContent value="prompts">
                <PromptsPane bookId={bookId} storyId={storyId} />
              </TabsContent>
            </Tabs>
          </>
        )
      )}
    </div>
  );
}

// ---------- 资产双栏 ----------

function AssetPane({
  bookId,
  storyId,
  type,
  assets,
}: {
  bookId: string;
  storyId: string;
  type: StoryAssetType;
  assets: AnyAsset[];
}) {
  const [sp, setSp] = useSearchParams();
  const selKey = `sel-${type}`;
  const selectedName = sp.get(selKey) ?? assets[0]?.name;
  const selected = assets.find((a) => a.name === selectedName) ?? assets[0];

  const moveSelection = (dir: 1 | -1) => {
    if (!selected || assets.length === 0) return;
    const idx = assets.findIndex((a) => a.name === selected.name);
    const next = assets[Math.max(0, Math.min(assets.length - 1, idx + dir))];
    if (next) {
      sp.set(selKey, next.name);
      setSp(sp, { replace: true });
    }
  };

  // 仅激活中的 Tab 挂载本组件，快捷键不会跨 Tab 冲突
  useKeyboardShortcuts(
    {
      j: () => moveSelection(1),
      k: () => moveSelection(-1),
      arrowdown: () => moveSelection(1),
      arrowup: () => moveSelection(-1),
    },
    true,
  );

  if (assets.length === 0) {
    return <p className="p-6 text-sm text-muted-foreground">本故事段未提取到{typeLabel(type)}。</p>;
  }

  return (
    <div className="grid h-[calc(100vh-22rem)] grid-cols-[minmax(240px,1fr)_minmax(0,2fr)] overflow-hidden rounded-lg border bg-card">
      <div className="overflow-y-auto border-r">
        {assets.map((a) => (
          <button
            key={a.name}
            type="button"
            onClick={() => {
              sp.set(selKey, a.name);
              setSp(sp, { replace: true });
            }}
            className={cn(
              'block w-full border-b px-3 py-2 text-left transition-colors hover:bg-accent/50',
              a.name === selected?.name && 'bg-accent',
            )}
          >
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {a.name}
                {a.needsDescriptionRepair && <span className="ml-1 text-amber-500">⚠</span>}
              </span>
              <Badge variant={a.assetStatus === 'confirmed' ? 'success' : 'muted'}>
                {a.assetStatus === 'confirmed' ? '确认' : '候选'}
              </Badge>
            </div>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{subLabel(type, a)}</p>
          </button>
        ))}
      </div>
      <div className="overflow-y-auto">
        {selected && <AssetDetail bookId={bookId} storyId={storyId} type={type} asset={selected} />}
      </div>
    </div>
  );
}

function typeLabel(type: StoryAssetType): string {
  return type === 'character' ? '角色' : type === 'scene' ? '场景' : '道具';
}

function subLabel(type: StoryAssetType, a: AnyAsset): string {
  if (type === 'character') {
    const c = a as CharacterInStory;
    return ROLE_LABEL[c.roleInStory] ?? c.roleInStory;
  }
  if (type === 'scene') {
    const s = a as SceneInStory;
    return s.location;
  }
  const p = a as PropInStory;
  return PROP_TYPE_LABEL[p.propType] ?? p.propType;
}

function AssetDetail({
  bookId,
  storyId,
  type,
  asset,
}: {
  bookId: string;
  storyId: string;
  type: StoryAssetType;
  asset: AnyAsset;
}) {
  const patchM = usePatchAsset(bookId, storyId);

  const save = (patch: Parameters<typeof patchM.mutate>[0]['patch']) => {
    patchM.mutate(
      { assetType: type, assetName: asset.name, patch },
      {
        onSuccess: () => toast.success('已保存'),
        onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
      },
    );
  };

  const character = type === 'character' ? (asset as CharacterInStory) : null;
  const scene = type === 'scene' ? (asset as SceneInStory) : null;
  const prop = type === 'prop' ? (asset as PropInStory) : null;

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">{asset.name}</h3>
          <p className="text-xs text-muted-foreground">{subLabel(type, asset)}</p>
        </div>
        <Badge variant={asset.assetStatus === 'confirmed' ? 'success' : 'muted'}>
          {asset.assetStatus === 'confirmed' ? '确认资产' : '候选资产'}
        </Badge>
      </div>

      <ConfidenceBar value={asset.confidence} />

      {character && (
        <div className="space-y-2 text-sm">
          {character.aliases.length > 0 && <p>别名：{character.aliases.join('、')}</p>}
          <p>动机：{character.motivation || '（未提取）'}</p>
          <p>与冲突的关系：{character.conflictRelation || '（未提取）'}</p>
          {character.keyActions.length > 0 && (
            <div>
              关键行动：
              <ul className="mt-0.5 list-inside list-disc">
                {character.keyActions.map((k, i) => (
                  <li key={i}>{k}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {scene && (
        <div className="space-y-2 text-sm">
          <p>位置：{scene.location}{scene.timeHint ? ` · ${scene.timeHint}` : ''}</p>
          <p>摘要：{scene.summary}</p>
          <p>冲突节拍：{scene.conflictBeat}</p>
          {scene.involvedCharacters.length > 0 && <p>出场角色：{scene.involvedCharacters.join('、')}</p>}
        </div>
      )}
      {prop && (
        <div className="space-y-2 text-sm">
          {prop.aliases.length > 0 && <p>别名：{prop.aliases.join('、')}</p>}
          <p>故事功能：{prop.storyFunction}</p>
          {prop.ownerOrHolder && <p>持有者：{prop.ownerOrHolder}</p>}
          <p>首次出现：{prop.firstAppearance}</p>
          {prop.keyMoments.length > 0 && (
            <div>
              关键时刻：
              <ul className="mt-0.5 list-inside list-disc">
                {prop.keyMoments.map((k, i) => (
                  <li key={i}>{k}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <EditableTextBlock
        label={`描述（质量：${DESCRIPTION_QUALITY_LABEL[asset.descriptionQuality] ?? asset.descriptionQuality}）`}
        value={asset.description}
        needsRepair={asset.needsDescriptionRepair}
        saving={patchM.isPending}
        onSave={(next) => save({ description: next })}
      />

      {character && (
        <EditableTextBlock
          label="外观描述"
          value={character.appearanceDescription}
          needsRepair={character.needsAppearanceRepair}
          saving={patchM.isPending}
          onSave={(next) => save({ appearanceDescription: next })}
        />
      )}

      <EditableTextBlock
        label="视觉提示词"
        value={asset.visualPrompt}
        saving={patchM.isPending}
        onSave={(next) => save({ visualPrompt: next })}
      />

      <EvidenceSnippets snippets={asset.evidenceSnippets} chapters={asset.sourceChapters} />
    </div>
  );
}

// ---------- 提示词 Tab ----------

function PromptsPane({ bookId, storyId }: { bookId: string; storyId: string }) {
  const promptsQ = useAssetPrompts(bookId, storyId);
  const pack = promptsQ.data;
  const [filter, setFilter] = useState<'all' | 'character' | 'scene' | 'prop'>('all');

  const prompts = useMemo(() => {
    if (!pack) return [];
    if (filter === 'all') return pack.allPrompts;
    return pack.allPrompts.filter((p) => p.assetType === filter);
  }, [pack, filter]);

  if (promptsQ.isLoading) return <p className="p-6 text-sm text-muted-foreground">加载中…</p>;
  if (!pack) return <p className="p-6 text-sm text-muted-foreground">提示词尚未生成。</p>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          {(['all', 'character', 'scene', 'prop'] as const).map((f) => (
            <Button
              key={f}
              size="sm"
              variant={filter === f ? 'secondary' : 'ghost'}
              onClick={() => setFilter(f)}
            >
              {f === 'all' ? `全部 ${pack.allPrompts.length}` : typeLabel(f)}
            </Button>
          ))}
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => downloadJson(pack, `asset-prompts-${storyId}.json`)}
        >
          <Download className="mr-1.5 h-4 w-4" />
          下载整包 JSON
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {prompts.map((p) => (
          <div key={`${p.assetType}-${p.assetId}`} className="rounded-lg border bg-card p-3">
            <div className="mb-2 flex items-center gap-2">
              <Badge variant="outline">{typeLabel(p.assetType)}</Badge>
              <span className="text-sm font-medium">{p.assetName}</span>
              {p.needsDescriptionRepair && (
                <Badge variant="warning">描述待修复</Badge>
              )}
            </div>
            <PromptCopyBlock prompt={p.prompt} negativePrompt={p.negativePrompt} />
          </div>
        ))}
      </div>
    </div>
  );
}
