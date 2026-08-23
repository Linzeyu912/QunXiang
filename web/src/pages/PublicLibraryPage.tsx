import { memo, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Search, Flame, Clock, X } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  usePublicAssets,
  useMyPublicAssets,
  useUnlistAsset,
  usePopularTags,
} from '@/api/public-assets';
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
import { GENRE_TAGS, isGenreTag } from '@/constants/genre-tags';
import { useAuthStore } from '@/store/authStore';
import type { PublicAssetListItem } from '@/types';

const KIND_LABELS: Record<string, string> = {
  character: '角色',
  location: '场景',
  item: '道具',
};

export function PublicLibraryPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const [tab, setTab] = useState<'browse' | 'mine'>('browse');
  const [kind, setKind] = useState<string>('');
  const [sort, setSort] = useState<'new' | 'hot'>('new');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  const browseQuery = usePublicAssets({
    kind: kind || undefined,
    sort,
    q: search || undefined,
    tags: selectedTags.length > 0 ? selectedTags : undefined,
  });

  const mineQuery = useMyPublicAssets();
  const unlistMutation = useUnlistAsset();
  const popularTagsQuery = usePopularTags();

  const popularTags = popularTagsQuery.data?.items ?? [];
  // 热门标签里排除已是题材标签的，只显示自定义热门
  const customPopularTags = useMemo(
    () => popularTags.filter((t) => !isGenreTag(t.tag)),
    [popularTags],
  );

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  };

  const items =
    tab === 'browse'
      ? (browseQuery.data?.items ?? [])
      : (mineQuery.data ?? []);

  const handleSearch = () => {
    setSearch(searchInput);
  };

  const handleUnlist = async (assetId: string) => {
    try {
      await unlistMutation.mutateAsync(assetId);
      toast.success('已下架');
    } catch (e) {
      toast.error(`下架失败：${(e as Error).message}`);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">公共素材库</h1>
        <p className="text-sm text-muted-foreground">
          浏览所有用户分享的实体素材（角色、场景、道具），拿取到你自己的书库
        </p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as 'browse' | 'mine')}>
        <TabsList>
          <TabsTrigger value="browse">浏览公共池</TabsTrigger>
          <TabsTrigger value="mine">我的发布</TabsTrigger>
        </TabsList>

        {tab === 'browse' && (
          <div className="space-y-4">
            {/* 筛选栏 */}
            <div className="flex flex-wrap items-center gap-3">
              <Tabs value={kind} onValueChange={setKind}>
                <TabsList>
                  <TabsTrigger value="">全部</TabsTrigger>
                  <TabsTrigger value="character">角色</TabsTrigger>
                  <TabsTrigger value="location">场景</TabsTrigger>
                  <TabsTrigger value="item">道具</TabsTrigger>
                </TabsList>
              </Tabs>

              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant={sort === 'new' ? 'default' : 'outline'}
                  onClick={() => setSort('new')}
                >
                  <Clock className="mr-1 h-3.5 w-3.5" />
                  最新
                </Button>
                <Button
                  size="sm"
                  variant={sort === 'hot' ? 'default' : 'outline'}
                  onClick={() => setSort('hot')}
                >
                  <Flame className="mr-1 h-3.5 w-3.5" />
                  最热
                </Button>
              </div>

              <div className="flex items-center gap-2">
                <Input
                  placeholder="搜索名称或简介…"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  className="w-48"
                />
                <Button size="sm" variant="outline" onClick={handleSearch}>
                  <Search className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* 题材分区栏 */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">题材：</span>
              {GENRE_TAGS.map((genre) => {
                const active = selectedTags.includes(genre);
                return (
                  <Badge
                    key={genre}
                    variant={active ? 'default' : 'outline'}
                    className="cursor-pointer"
                    onClick={() => toggleTag(genre)}
                  >
                    {genre}
                  </Badge>
                );
              })}
            </div>

            {/* 热门标签 */}
            {customPopularTags.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">热门：</span>
                {customPopularTags.slice(0, 15).map((t) => (
                  <Badge
                    key={t.tag}
                    variant={selectedTags.includes(t.tag) ? 'default' : 'secondary'}
                    className="cursor-pointer"
                    onClick={() => toggleTag(t.tag)}
                  >
                    {t.tag}
                    <span className="ml-1 text-xs opacity-60">×{t.count}</span>
                  </Badge>
                ))}
              </div>
            )}

            {/* 已选筛选条件 */}
            {selectedTags.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">已选：</span>
                {selectedTags.map((tag) => (
                  <Badge
                    key={tag}
                    variant="default"
                    className="cursor-pointer"
                    onClick={() => toggleTag(tag)}
                  >
                    {tag}
                    <X className="ml-1 h-3 w-3" />
                  </Badge>
                ))}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-xs text-muted-foreground"
                  onClick={() => setSelectedTags([])}
                >
                  清除全部
                </Button>
              </div>
            )}

            {/* 卡片网格 */}
            {browseQuery.isLoading ? (
              <p className="py-10 text-center text-sm text-muted-foreground">加载中…</p>
            ) : items.length === 0 ? (
              <Card className="p-10 text-center text-sm text-muted-foreground">
                暂无公共素材
              </Card>
            ) : (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {items.map((item) => (
                  <AssetCard
                    key={item.id}
                    item={item}
                    onClick={() => navigate(`/public/${item.id}`)}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'mine' && (
          <div className="space-y-4">
            {mineQuery.isLoading ? (
              <p className="py-10 text-center text-sm text-muted-foreground">加载中…</p>
            ) : items.length === 0 ? (
              <Card className="p-10 text-center text-sm text-muted-foreground">
                你还没有发布过素材。在实体审核页点击"发布到公共库"即可分享。
              </Card>
            ) : (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {items.map((item) => (
                  <AssetCard
                    key={item.id}
                    item={item}
                    onClick={() => navigate(`/public/${item.id}`)}
                    isOwner={item.publisherId === user?.id}
                    onUnlist={() => handleUnlist(item.id)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </Tabs>
    </div>
  );
}

const AssetCard = memo(function AssetCard({
  item,
  onClick,
  isOwner,
  onUnlist,
}: {
  item: PublicAssetListItem;
  onClick: () => void;
  isOwner?: boolean;
  onUnlist?: () => void;
}) {
  return (
    <Card className="group cursor-pointer overflow-hidden p-0 transition-shadow hover:shadow-md" >
      <div className="relative aspect-[3/4] overflow-hidden bg-muted" onClick={onClick}>
        {item.primaryImageUrl ? (
          <img
            src={item.primaryImageUrl}
            alt={item.name}
            className="h-full w-full object-cover transition-transform group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <span className="text-xs">无图片</span>
          </div>
        )}
        <div className="absolute left-2 top-2">
          <Badge variant="default">{KIND_LABELS[item.kind] ?? item.kind}</Badge>
        </div>
        {item.status === 'unlisted' && (
          <div className="absolute right-2 top-2">
            <Badge variant="muted">已下架</Badge>
          </div>
        )}
      </div>
      <div className="space-y-1 p-3" onClick={onClick}>
        <p className="truncate text-sm font-medium">{item.name}</p>
        <p className="line-clamp-2 text-xs text-muted-foreground">
          {item.summary || '暂无简介'}
        </p>
        <div className="flex items-center justify-between pt-1">
          <span className="text-xs text-muted-foreground">
            {item.publisherName || '匿名'}
          </span>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Flame className="h-3 w-3" />
            {item.takenCount}
          </span>
        </div>
        {item.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1">
            {item.tags.slice(0, 3).map((tag) => (
              <Badge key={tag} variant="outline" className="text-xs">
                {tag}
              </Badge>
            ))}
          </div>
        )}
      </div>
      {isOwner && item.status !== 'unlisted' && onUnlist && (
        <div className="border-t px-3 py-2">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="w-full text-xs text-destructive"
                onClick={(e) => e.stopPropagation()}
              >
                下架
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>下架「{item.name}」？</AlertDialogTitle>
                <AlertDialogDescription>下架后其他用户将无法看到此素材。</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction onClick={onUnlist}>确认下架</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}
    </Card>
  );
});
