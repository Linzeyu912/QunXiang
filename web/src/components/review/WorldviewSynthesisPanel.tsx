import { toast } from 'sonner';
import { BookOpen, Loader2, Sparkles } from 'lucide-react';
import { useWorldviewSynthesis, useWorldviewSynthesisResult } from '@/api/entities';
import { Button } from '@/components/ui/button';
import type { WorldviewSynthesis } from '@/types';

interface Props {
  bookId: string;
}

/** 世界观体系梳理面板——手动触发模型全文梳理，展示结构化世界观文档。 */
export function WorldviewSynthesisPanel({ bookId }: Props) {
  const savedQuery = useWorldviewSynthesisResult(bookId);
  const mutation = useWorldviewSynthesis(bookId);
  const synthesis = mutation.data?.synthesis ?? savedQuery.data ?? null;

  const handleSynthesize = () => {
    mutation.mutate(undefined, {
      onSuccess: () => toast.success('世界观梳理完成'),
      onError: (error) => toast.error(error instanceof Error ? error.message : '梳理失败，请稍后重试'),
    });
  };

  return (
    <div className="space-y-4">
      {synthesis ? (
        <>
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">以下内容由模型根据全文自动梳理生成</p>
            <SynthesizeButton pending={mutation.isPending} onClick={handleSynthesize} label="重新梳理" />
          </div>
          <SynthesisDisplay synthesis={synthesis} />
        </>
      ) : (
        <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-4 py-3">
          <BookOpen className="h-5 w-5 text-muted-foreground" />
          <div className="flex-1">
            <p className="text-sm font-medium">世界观体系梳理</p>
            <p className="text-xs text-muted-foreground">让模型通读全文，对世界观、修炼体系、规则法则等进行结构化总结</p>
          </div>
          <SynthesizeButton pending={mutation.isPending} onClick={handleSynthesize} label="梳理世界观" />
        </div>
      )}
    </div>
  );
}

function SynthesizeButton({ pending, onClick, label }: {
  pending: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <Button onClick={onClick} disabled={pending} variant={label === '重新梳理' ? 'outline' : 'default'} size="sm">
      {pending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1 h-4 w-4" />}
      {pending ? '梳理中…' : label}
    </Button>
  );
}

/** 结构化世界观文档展示。 */
function SynthesisDisplay({ synthesis }: { synthesis: WorldviewSynthesis }) {
  return (
    <div className="space-y-6 rounded-lg border bg-card p-6">
      {synthesis.overview && (
        <Section title="世界观总览">
          <div className="space-y-3">
            {synthesis.overview.split('\n').filter(Boolean).map((paragraph, index) => (
              <p key={index} className="text-sm leading-relaxed">{paragraph}</p>
            ))}
          </div>
        </Section>
      )}

      {synthesis.cultivationSystem && (
        <Section title="修炼体系">
          <p className="text-sm leading-relaxed">{synthesis.cultivationSystem.summary}</p>
          {synthesis.cultivationSystem.details && (
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {synthesis.cultivationSystem.details}
            </p>
          )}
          {synthesis.cultivationSystem.levels.length > 0 && (
            <div className="mt-3 space-y-2">
              {synthesis.cultivationSystem.levels.map((level, index) => (
                <div key={index} className="rounded-md border bg-muted/20 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{level.name}</span>
                    {level.totalLevels && (
                      <span className="text-xs text-muted-foreground">（共{level.totalLevels}）</span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{level.description}</p>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {synthesis.rules && (
        <Section title="规则与法则">
          <p className="text-sm leading-relaxed">{synthesis.rules.summary}</p>
          {synthesis.rules.items.length > 0 && (
            <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-muted-foreground">
              {synthesis.rules.items.map((item, index) => <li key={index}>{item}</li>)}
            </ul>
          )}
        </Section>
      )}

      {synthesis.history && (
        <Section title="历史背景">
          <div className="space-y-3">
            {synthesis.history.split('\n').filter(Boolean).map((paragraph, index) => (
              <p key={index} className="text-sm leading-relaxed">{paragraph}</p>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h4 className="border-b pb-1 text-sm font-semibold">{title}</h4>
      {children}
    </div>
  );
}
