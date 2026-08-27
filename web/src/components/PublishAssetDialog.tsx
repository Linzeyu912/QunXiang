import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Loader2, RefreshCw, Sparkles, X } from 'lucide-react';
import { usePublishAsset, useSuggestPublishTags } from '@/api/public-assets';
import { GENRE_TAGS, isGenreTag } from '@/constants/genre-tags';
import type { EntityType } from '@/types';

interface PublishAssetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bookId: string;
  entityType: EntityType;
  entityId: string;
  entityName: string;
  defaultSummary?: string | null;
}

export function PublishAssetDialog({
  open,
  onOpenChange,
  bookId,
  entityType,
  entityId,
  entityName,
  defaultSummary,
}: PublishAssetDialogProps) {
  const [summary, setSummary] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [showSource, setShowSource] = useState(true);
  // 版权声明（实施包 H2）：发布必填
  const [licenseType, setLicenseType] = useState<'original' | 'authorized' | 'public_domain' | ''>('');
  const [attributionRequired, setAttributionRequired] = useState(false);
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const publishMutation = usePublishAsset();
  const suggestQuery = useSuggestPublishTags({ open, bookId, entityType, entityId });
  // 用户手动改过标签后，识别结果不再自动覆盖
  const userEditedTagsRef = useRef(false);
  // 题材标签的选择态在题材区体现，徽章区只展示真正的自定义标签
  const customTags = tags.filter((tag) => !isGenreTag(tag));

  useEffect(() => {
    if (open) {
      setSummary(defaultSummary?.slice(0, 80) || '');
      setTags([]);
      setTagInput('');
      setShowSource(true);
      setLicenseType('');
      setAttributionRequired(false);
      setRightsConfirmed(false);
      userEditedTagsRef.current = false;
    }
  }, [open, defaultSummary]);

  // 识别结果自动预填（题材自动选中 + 自定义标签就位），用户手动编辑过则不打扰。
  // 依赖 open：缓存有效期内重新打开时 data 引用不变，需靠 open 变化重新填充
  useEffect(() => {
    const data = suggestQuery.data;
    if (!open || !data || userEditedTagsRef.current) return;
    setTags([...data.genres, ...data.tags]);
  }, [open, suggestQuery.data]);

  const toggleTag = (tag: string) => {
    userEditedTagsRef.current = true;
    setTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  };

  const addTag = () => {
    const trimmed = tagInput.trim();
    if (trimmed && !tags.includes(trimmed)) {
      userEditedTagsRef.current = true;
      setTags([...tags, trimmed]);
    }
    setTagInput('');
  };

  const removeTag = (tag: string) => {
    userEditedTagsRef.current = true;
    setTags(tags.filter((t) => t !== tag));
  };

  const handleResuggest = async () => {
    userEditedTagsRef.current = false;
    // refetch 后主动应用结果：数据未变化时引用不变（structural sharing），
    // 依赖 data 引用变化的 useEffect 不会触发，需在此直接填充
    const result = await suggestQuery.refetch();
    if (result.isSuccess && result.data) {
      setTags([...result.data.genres, ...result.data.tags]);
    }
  };

  const handlePublish = async () => {
    try {
      const result = await publishMutation.mutateAsync({
        bookId,
        entityType,
        entityId,
        summary: summary.trim() || undefined,
        tags: tags.length > 0 ? tags : undefined,
        showSource,
        licenseType: licenseType || undefined,
        attributionRequired,
        rightsConfirmed,
      });
      toast.success(`已发布到公共素材库：${entityName}`);
      onOpenChange(false);
      void result;
    } catch (e) {
      toast.error(`发布失败：${(e as Error).message}`);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>发布到公共素材库</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="rounded-md bg-muted p-3 text-sm">
            <span className="text-muted-foreground">实体名称：</span>
            {entityName}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="publish-summary">一句话简介</Label>
            <Textarea
              id="publish-summary"
              placeholder="简短介绍这个实体（不填则取描述前80字）"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={2}
              maxLength={200}
            />
          </div>

          {/* 标签智能识别 */}
          {suggestQuery.isFetching ? (
            <div className="flex items-center gap-2 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              正在识别初步标签…
            </div>
          ) : suggestQuery.data && (suggestQuery.data.genres.length > 0 || suggestQuery.data.tags.length > 0) ? (
            <div className="flex items-center justify-between gap-2 rounded-md border border-emerald-300 bg-emerald-50/40 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300">
              <span className="flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 shrink-0" />
                {suggestQuery.data.source === 'llm'
                  ? '已自动识别初步标签，可直接发布或点击修改'
                  : suggestQuery.data.message || '已识别初步标签，可点击修改'}
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 shrink-0 px-2 text-xs text-emerald-700 hover:text-emerald-800 dark:text-emerald-300 dark:hover:text-emerald-200"
                onClick={handleResuggest}
                disabled={suggestQuery.isFetching}
              >
                <RefreshCw className="mr-1 h-3 w-3" />
                重新识别
              </Button>
            </div>
          ) : suggestQuery.isError || suggestQuery.data ? (
            <div className="flex items-center justify-between gap-2 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
              <span>
                {suggestQuery.isError
                  ? '标签识别服务暂不可用，可手动选择标签'
                  : suggestQuery.data?.message || '未识别到合适的标签，请手动选择'}
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 shrink-0 px-2 text-xs"
                onClick={handleResuggest}
                disabled={suggestQuery.isFetching}
              >
                <RefreshCw className="mr-1 h-3 w-3" />
                重新识别
              </Button>
            </div>
          ) : null}

          {/* 题材分类 */}
          <div className="space-y-1.5">
            <Label>题材分类</Label>
            <p className="text-xs text-muted-foreground">点击选择适合的题材（可选）</p>
            <div className="flex flex-wrap gap-1.5">
              {GENRE_TAGS.map((genre) => {
                const selected = tags.includes(genre);
                return (
                  <Badge
                    key={genre}
                    variant={selected ? 'default' : 'outline'}
                    className="cursor-pointer"
                    onClick={() => toggleTag(genre)}
                  >
                    {genre}
                  </Badge>
                );
              })}
            </div>
          </div>

          {/* 自定义标签 */}
          <div className="space-y-1.5">
            <Label htmlFor="publish-tag">自定义标签</Label>
            <div className="flex items-center gap-2">
              <Input
                id="publish-tag"
                placeholder="输入标签后回车"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addTag();
                  }
                }}
                className="flex-1"
              />
              <Button size="sm" variant="outline" onClick={addTag}>
                添加
              </Button>
            </div>
            {customTags.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-1">
                {customTags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="cursor-pointer" onClick={() => removeTag(tag)}>
                    {tag}
                    <X className="ml-1 h-3 w-3" />
                  </Badge>
                ))}
              </div>
            )}
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showSource}
              onChange={(e) => setShowSource(e.target.checked)}
              className="rounded"
            />
            展示来源书名（署名）
          </label>

          <div className="space-y-1.5 rounded-md border p-3">
            <p className="text-sm font-medium">版权声明（必填）</p>
            <div className="flex flex-wrap gap-3 text-sm">
              {([
                ['original', '本人原创'],
                ['authorized', '已获授权'],
                ['public_domain', '公版内容'],
              ] as const).map(([value, label]) => (
                <label key={value} className="flex items-center gap-1">
                  <input
                    type="radio"
                    name="publish-license"
                    checked={licenseType === value}
                    onChange={() => setLicenseType(value)}
                  />
                  {label}
                </label>
              ))}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={attributionRequired}
                onChange={(e) => setAttributionRequired(e.target.checked)}
              />
              要求署名（拿取方使用时需保留署名）
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={rightsConfirmed}
                onChange={(e) => setRightsConfirmed(e.target.checked)}
              />
              我确认对发布内容拥有相应权利，发布不侵犯他人著作权
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            onClick={handlePublish}
            disabled={publishMutation.isPending || !licenseType || !rightsConfirmed}
            title={!licenseType ? '请选择版权声明' : !rightsConfirmed ? '请勾选权利确认' : undefined}
          >
            {publishMutation.isPending ? '发布中…' : '确认发布'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
