import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useLlmStatus } from '@/api/llm';
import { TextModelSection } from '@/components/settings/TextModelSection';
import { ConcurrencySection } from '@/components/settings/ConcurrencySection';
import { ImageModelSection } from '@/components/settings/ImageModelSection';
import { BaseUrlHelp } from '@/components/settings/BaseUrlHelp';

/**
 * 模型与生成设置：按「文本模型 → 并发策略 → 文生图模型」分区。
 * 各区块实现见 components/settings/，保存时机与请求体保持原语义。
 */
export function LlmSettingsPage() {
  const { isLoading } = useLlmStatus();

  if (isLoading) {
    return <LlmSettingsSkeleton />;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">模型与生成设置</h1>
        <p className="text-sm text-muted-foreground">配置文本提取模型与文生图模型</p>
      </div>

      <TextModelSection />
      <ConcurrencySection />
      <ImageModelSection />
      <BaseUrlHelp />
    </div>
  );
}

/** LLM 设置页加载骨架：标题 + 状态卡 + 配置表单卡占位，贴合真实布局。 */
function LlmSettingsSkeleton() {
  return (
    <div className="mx-auto max-w-2xl space-y-6" aria-label="设置加载中">
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-64" />
      </div>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-5 w-14" />
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-3">
          <Skeleton className="h-5 w-24" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-9 w-full" />
        </CardContent>
      </Card>
    </div>
  );
}
