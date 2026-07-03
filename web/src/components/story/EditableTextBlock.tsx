import { useEffect, useState } from 'react';
import { Loader2, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

/** 可编辑文本块：用于修复资产 description / visualPrompt / 外观描述。 */
export function EditableTextBlock({
  label,
  value,
  needsRepair,
  saving,
  onSave,
}: {
  label: string;
  value: string;
  needsRepair?: boolean;
  saving?: boolean;
  onSave: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
    setEditing(false);
  }, [value]);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          {label}
          {needsRepair && <span className="ml-2 text-amber-600 dark:text-amber-400">⚠ 需修复</span>}
        </span>
        {!editing && (
          <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => setEditing(true)}>
            <Pencil className="mr-1 h-3 w-3" />
            编辑
          </Button>
        )}
      </div>
      {editing ? (
        <div className="space-y-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={4}
            className="text-sm"
            placeholder="补充可用于图像生成的具体可见细节…"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={saving || draft.trim() === value.trim()}
              onClick={() => onSave(draft.trim())}
            >
              {saving && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              保存
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setDraft(value);
                setEditing(false);
              }}
            >
              取消
            </Button>
          </div>
        </div>
      ) : (
        <p
          className={cn(
            'whitespace-pre-wrap rounded-md p-2 text-sm leading-relaxed',
            needsRepair
              ? 'border border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200'
              : 'bg-muted/50',
            !value && 'italic text-muted-foreground',
          )}
        >
          {value || '（空缺）'}
        </p>
      )}
    </div>
  );
}
