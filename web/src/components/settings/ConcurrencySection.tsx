import { toast } from 'sonner';
import { CheckCircle2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useLlmStatus, useSetConcurrencyMode } from '@/api/llm';
import type { ConcurrencyMode } from '@/types';
import { cn } from '@/lib/utils';

/** 并发模式：多密钥并行多本 vs 集中单本提速，切换语义与原页面一致。 */
export function ConcurrencySection() {
  const { data: status } = useLlmStatus();
  const setMode = useSetConcurrencyMode();

  const switchMode = async (mode: ConcurrencyMode) => {
    try {
      await setMode.mutateAsync(mode);
      toast.success(mode === 'parallel-books' ? '已切换为优先并行多本' : '已切换为优先单本速度');
    } catch (error) {
      toast.error(`切换失败：${(error as Error).message}`);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>并发模式</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          多密钥可用于并行处理多本书，也可以集中处理当前一本。
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label="并发模式">
          <ModeOption
            active={status?.concurrency?.mode === 'parallel-books'}
            disabled={setMode.isPending}
            onClick={() => switchMode('parallel-books')}
            title="优先并行多本"
            description={`工作进程数跟随密钥数${status?.concurrency ? `，当前 ${status.concurrency.workers} 个` : ''}`}
          />
          <ModeOption
            active={status?.concurrency?.mode === 'single-book-speed'}
            disabled={setMode.isPending}
            onClick={() => switchMode('single-book-speed')}
            title="优先单本速度"
            description="使用一个工作进程，把调用额度集中给当前书籍"
          />
        </div>
        {status?.concurrency && (
          <p className="rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">
            已检测到 {status.concurrency.keyCount} 个密钥，建议可同时处理 {status.concurrency.recommended} 本书。
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ModeOption({
  active,
  disabled,
  onClick,
  title,
  description,
}: {
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  title: string;
  description: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'rounded-md border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
        active ? 'border-primary bg-primary/5' : 'hover:bg-accent/40',
      )}
    >
      <span className="flex items-center gap-1.5 text-sm font-medium">
        {active && <CheckCircle2 className="h-3.5 w-3.5 text-primary" />}
        {title}
      </span>
      <span className="mt-1 block text-xs text-muted-foreground">{description}</span>
    </button>
  );
}
