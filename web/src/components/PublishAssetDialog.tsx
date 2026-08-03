import { useState, useEffect } from 'react';
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
import { X } from 'lucide-react';
import { usePublishAsset } from '@/api/public-assets';
import { GENRE_TAGS } from '@/constants/genre-tags';
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
  const publishMutation = usePublishAsset();

  useEffect(() => {
    if (open) {
      setSummary(defaultSummary?.slice(0, 80) || '');
      setTags([]);
      setTagInput('');
      setShowSource(true);
    }
  }, [open, defaultSummary]);

  const toggleTag = (tag: string) => {
    setTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  };

  const addTag = () => {
    const trimmed = tagInput.trim();
    if (trimmed && !tags.includes(trimmed)) {
      setTags([...tags, trimmed]);
    }
    setTagInput('');
  };

  const removeTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag));
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
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-1">
                {tags.map((tag) => (
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
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handlePublish} disabled={publishMutation.isPending}>
            {publishMutation.isPending ? '发布中…' : '确认发布'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
