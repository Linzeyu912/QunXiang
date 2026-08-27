import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Download } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { usePublicAssetDetail, useTakeAsset } from '@/api/public-assets';
import { useBooks } from '@/api/books';
import { formatDate } from '@/lib/utils';

const KIND_LABELS: Record<string, string> = {
  character: '角色',
  location: '场景',
  item: '道具',
};

export function PublicAssetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const detailQuery = usePublicAssetDetail(id);
  const booksQuery = useBooks();
  const takeMutation = useTakeAsset();
  const [takeDialogOpen, setTakeDialogOpen] = useState(false);
  const [targetBookId, setTargetBookId] = useState('');

  if (detailQuery.isLoading) {
    return <div className="py-10 text-center text-sm text-muted-foreground">加载中…</div>;
  }

  if (detailQuery.isError || !detailQuery.data) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" onClick={() => navigate('/public')}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          返回公共素材库
        </Button>
        <Card className="p-10 text-center text-sm text-muted-foreground">
          素材不存在或已下架
        </Card>
      </div>
    );
  }

  const asset = detailQuery.data;
  const payload = asset.payload;

  const handleTake = async () => {
    if (!targetBookId) {
      toast.error('请选择目标书');
      return;
    }
    try {
      const result = await takeMutation.mutateAsync({
        assetId: asset.id,
        targetBookId,
      });
      toast.success(`已拿取到书库：${result.entityName}`);
      setTakeDialogOpen(false);
      navigate(`/books/${targetBookId}/${asset.kind === 'character' ? 'characters' : asset.kind === 'location' ? 'locations' : 'items'}`);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes('已拿取')) {
        toast.error('该素材已拿取到目标书');
      } else {
        toast.error(`拿取失败：${msg}`);
      }
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/public')}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          返回
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[400px_1fr]">
        {/* 左侧：图片画廊 */}
        <div className="space-y-3">
          {asset.images.length === 0 ? (
            <Card className="flex aspect-[3/4] items-center justify-center text-sm text-muted-foreground">
              无图片
            </Card>
          ) : (
            <div className="space-y-3">
              {asset.images.map((img) => (
                <Card key={img.id} className="overflow-hidden p-0">
                  <img
                    src={img.url}
                    alt={asset.name}
                    className="w-full object-contain"
                    style={{ maxHeight: '500px' }}
                  />
                  {img.stage && (
                    <div className="px-3 py-1 text-xs text-muted-foreground">
                      阶段：{img.stage}
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* 右侧：详情 */}
        <div className="space-y-4">
          <div>
            <div className="flex items-center gap-2">
              <Badge variant="default">{KIND_LABELS[asset.kind] ?? asset.kind}</Badge>
              <h1 className="text-2xl font-semibold tracking-tight">{asset.name}</h1>
            </div>
            {asset.summary && (
              <p className="mt-2 text-sm text-muted-foreground">{asset.summary}</p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
            <span>发布者：{asset.publisherName || '匿名'}</span>
            <span>拿取次数：{asset.takenCount}</span>
            <span>发布时间：{formatDate(asset.createdAt)}</span>
            {asset.licenseType && (
              <span>
                版权声明：
                {asset.licenseType === 'original' ? '本人原创' : asset.licenseType === 'authorized' ? '已获授权' : '公版内容'}
                {asset.attributionRequired ? '（要求署名）' : ''}
              </span>
            )}
          </div>

          {asset.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {asset.tags.map((tag) => (
                <Badge key={tag} variant="outline">{tag}</Badge>
              ))}
            </div>
          )}

          <Button onClick={() => setTakeDialogOpen(true)} disabled={takeMutation.isPending}>
            <Download className="mr-1 h-4 w-4" />
            拿取到我的书库
          </Button>

          {/* payload 展示 */}
          {payload.aliases && payload.aliases.length > 0 && (
            <Card className="p-4">
              <h3 className="mb-2 text-sm font-medium">别名</h3>
              <div className="flex flex-wrap gap-1">
                {payload.aliases.map((alias, i) => (
                  <Badge key={i} variant="secondary">{alias}</Badge>
                ))}
              </div>
            </Card>
          )}

          {payload.description && (
            <Card className="p-4">
              <h3 className="mb-2 text-sm font-medium">描述</h3>
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                {payload.description}
              </p>
            </Card>
          )}

          {payload.enhancedDescription && (
            <Card className="p-4">
              <h3 className="mb-2 text-sm font-medium">视觉描写</h3>
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                {payload.enhancedDescription}
              </p>
            </Card>
          )}

          {payload.visualDetails && Object.keys(payload.visualDetails).length > 0 && (
            <Card className="p-4">
              <h3 className="mb-2 text-sm font-medium">视觉设定</h3>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                {Object.entries(payload.visualDetails).map(([key, value]) => (
                  <div key={key}>
                    <dt className="text-xs text-muted-foreground">{key}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          )}

          {payload.promptVariants && payload.promptVariants.length > 0 && (
            <Card className="p-4">
              <h3 className="mb-2 text-sm font-medium">提示词版本</h3>
              <div className="space-y-3">
                {payload.promptVariants.map((variant, i) => (
                  <div key={i} className="rounded-md border p-3">
                    <div className="mb-1 flex items-center gap-2">
                      <span className="text-xs font-medium">
                        {variant.label || variant.stage || `版本 ${i + 1}`}
                      </span>
                      {variant.isPrimary && <Badge variant="default" className="text-xs">主</Badge>}
                    </div>
                    {variant.prompt && (
                      <p className="whitespace-pre-wrap text-xs text-muted-foreground">
                        {variant.prompt}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {payload.sourceBookTitle && (
            <p className="text-xs text-muted-foreground">
              来源书籍：{payload.sourceBookTitle}
            </p>
          )}
        </div>
      </div>

      {/* 拿取弹窗 */}
      <Dialog open={takeDialogOpen} onOpenChange={setTakeDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>拿取到我的书库</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              选择一本你的书，该素材将以待审核状态进入该书：
            </p>
            <Select value={targetBookId} onValueChange={setTargetBookId}>
              <SelectTrigger>
                <SelectValue placeholder="选择目标书…" />
              </SelectTrigger>
              <SelectContent>
                {(booksQuery.data ?? []).map((book) => (
                  <SelectItem key={book.id} value={book.id}>
                    {book.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTakeDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={handleTake} disabled={!targetBookId || takeMutation.isPending}>
              确认拿取
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
