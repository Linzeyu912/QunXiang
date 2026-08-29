import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

/** 提示词代码块：看得清、复制快。 */
export function PromptCopyBlock({
  label,
  prompt,
  negativePrompt,
}: {
  label?: string;
  prompt: string;
  negativePrompt?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      toast.success('提示词已复制');
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('复制失败，请手动选择文本');
    }
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        {label && <span className="text-xs font-medium text-muted-foreground">{label}</span>}
        <Button variant="ghost" size="sm" className="h-6 px-2" onClick={copy} aria-label="复制提示词" title="复制提示词">
          {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
      </div>
      <pre className="whitespace-pre-wrap rounded-md bg-muted p-3 text-xs leading-relaxed">{prompt}</pre>
      {negativePrompt && (
        <pre className="whitespace-pre-wrap rounded-md border border-dashed border-destructive/30 bg-destructive/5 p-2 text-xs leading-relaxed text-muted-foreground">
          负向：{negativePrompt}
        </pre>
      )}
    </div>
  );
}
